/**
 * Shared state of the extension: where things are, how to call the `code` CLI, the loaded preset, and the
 * per-profile status (declared vs installed) that the tree and the status bar show.
 */
import { existsSync } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  type CodeRunner,
  COMPAT_CHECKED_VERSION,
  createCodeRunner,
  diffExtensions,
  type ExtensionDiff,
  type ExtensionRelations,
  explainExtras,
  type ExtraReason,
  folderProfile,
  OneAtATime,
  parsePresetText,
  type Preset,
  PresetError,
  type PresetSource,
  presetSourceFrom,
  presetStatus,
  syncedPresetText,
  type PresetStatus,
  profileNames,
  resolveProfile,
  type StorageProfiles,
  type StoredProfile,
} from '../core';
import { readStorage } from '../host/apply';
import {
  type InstalledManifest,
  readApplicationScoped,
  readExtensionRelations,
  readInstalledExtensions,
} from '../host/builtins';
import { findCodeCli } from '../host/codeLocator';
import { listInstalled } from '../host/installer';
import {
  defaultExtensionsDir,
  defaultUserDataDir,
  userDataDirFromGlobalStorage,
  userDataPaths,
  type UserDataPaths,
} from '../host/paths';
import { readSyncedPreset, SYNCED_PRESET_URI, writeSyncedPreset } from './syncedPreset';

export interface LoadedPreset {
  uri: vscode.Uri;
  text: string;
  preset: Preset;
}

export interface ProfileRow {
  name: string;
  /** Declared in the preset. */
  declared: boolean;
  /** Exists in VS Code (storage.json). */
  stored?: StoredProfile;
  /** What is installed in it (Kit.installedIn); undefined while unknown or when the profile does not exist. */
  installed?: string[];
  /** Declared profiles that exist. */
  diff?: ExtensionDiff;
  /** Extras that another installed extension of the profile needs or bundles. */
  extraReasons?: ReadonlyMap<string, ExtraReason>;
  error?: string;
}

export const DEFAULT_PROFILE = 'Default';

/** PROFILE_KIT_CODE_ARGS: a JSON list of `code` options for an isolated VS Code (launch.json, scripts/integration). */
function testCodeArgs(): string[] {
  try {
    const parsed: unknown = JSON.parse(process.env.PROFILE_KIT_CODE_ARGS ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : [];
  } catch {
    // ignore a malformed test variable
    return [];
  }
}

/** The extension's view of the world. One instance per window. */
export class Kit implements vscode.Disposable {
  readonly output = vscode.window.createOutputChannel('Profile Kit');
  readonly paths: UserDataPaths;
  readonly run: CodeRunner;
  readonly codeCli: string | undefined;
  /** This VS Code's extensions folder; its extensions.json is Default's list (read only). */
  readonly extensionsDir: string;

  private loaded: LoadedPreset | undefined;
  private loadError: string | undefined;
  private storage: StorageProfiles = { profiles: [], folders: [], emptyWindows: [], problems: [] };
  private installed = new Map<string, string[] | undefined>();
  private applicationScoped = new Set<string>();
  /** What installed extensions need or bundle (their package.json), and the per-folder cache behind it. */
  private relations: ReadonlyMap<string, ExtensionRelations> = new Map();
  private readonly manifests = new Map<string, InstalledManifest | null>();
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires after the preset, the profile list or an installed list changed. */
  readonly onDidChange = this.changed.event;
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshing: Promise<void> | undefined;
  private readonly ownId: string;

  constructor(readonly context: vscode.ExtensionContext) {
    // follow --user-data-dir / portable mode: derive from where VS Code put our global storage
    const userData = userDataDirFromGlobalStorage(context.globalStorageUri.fsPath) ?? defaultUserDataDir();
    this.paths = userDataPaths(userData);
    this.ownId = context.extension.id.toLowerCase();
    this.codeCli = findCodeCli(vscode.env.appRoot);
    // The folder this extension is installed in. From a development folder (F5, the integration checks) that is not
    // an extensions folder: then the one the test setup names, so an isolated VS Code does not read the real one.
    const testArgs = testCodeArgs();
    const ownDir = path.dirname(context.extensionPath);
    const named = testArgs.indexOf('--extensions-dir');
    this.extensionsDir = existsSync(path.join(ownDir, 'extensions.json'))
      ? ownDir
      : ((named >= 0 ? testArgs[named + 1] : undefined) ?? defaultExtensionsDir());
    const { baseArgs, windowsBlocked } = this.codeBaseArgs(userData, testArgs);
    this.windowsBlocked = windowsBlocked;
    this.run = createCodeRunner(this.codeCli ?? 'code', { baseArgs, timeoutMs: 5 * 60_000 });
    // for bug reports: which VS Code this is, and the version Profile Kit's use of VS Code internals was checked on
    this.log(
      `VS Code ${vscode.version}, ${process.platform}; VS Code internals last checked on ${COMPAT_CHECKED_VERSION} (compat.ts)`,
    );
  }

  /**
   * Why Profile Kit must not open VS Code windows from here, or undefined when it may.
   * A `code` call that opens a window joins the running VS Code only when it names the same user data,
   * extensions AND shared data folders; otherwise it starts a second VS Code. The shared data folder
   * (`--shared-data-dir`, which holds sign-ins) cannot be read from the extension API, so in a VS Code started
   * with custom folders a window call could start an instance that uses the default shared data and signs the
   * user out (seen 2026-11-21 in the isolated test). Calls that open no window (list, install) are fine.
   */
  readonly windowsBlocked: string | undefined;

  /**
   * Arguments that point the `code` CLI at this window's VS Code. None for a normal install (same as typing `code`
   * in a terminal). For custom folders: `--user-data-dir` / `--extensions-dir` as far as they can be derived, plus
   * PROFILE_KIT_CODE_ARGS (a JSON list, for the isolated test setup; it must include `--shared-data-dir` to allow
   * window calls).
   */
  private codeBaseArgs(
    userData: string,
    extra: readonly string[],
  ): { baseArgs: string[]; windowsBlocked: string | undefined } {
    const same = (a: string, b: string) =>
      process.platform === 'win32' || process.platform === 'darwin'
        ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
        : path.resolve(a) === path.resolve(b);
    const derived: [string, string][] = [];
    if (!same(userData, defaultUserDataDir())) derived.push(['--user-data-dir', userData]);
    if (!same(this.extensionsDir, defaultExtensionsDir())) derived.push(['--extensions-dir', this.extensionsDir]);
    const windowsBlocked =
      derived.length > 0 && !extra.includes('--shared-data-dir')
        ? vscode.l10n.t(
            'This VS Code runs with its own data folders, so Profile Kit cannot open windows for it safely (a window could start a second VS Code that signs you out). Create the profile in VS Code first (Profiles editor), then try again.',
          )
        : undefined;
    // the test variable names the same folders again: each option once (VS Code warns about a repeated one)
    const args = derived.filter(([option]) => !extra.includes(option)).flat();
    return { baseArgs: [...args, ...extra], windowsBlocked };
  }

  get preset(): LoadedPreset | undefined {
    return this.loaded;
  }

  /** `profileKit.presetPath` is set but the file is not on this PC. */
  presetMissing = false;

  get presetError(): string | undefined {
    return this.loadError;
  }

  get profiles(): readonly StoredProfile[] {
    return this.storage.profiles;
  }

  get storageInfo(): StorageProfiles {
    return this.storage;
  }

  /** The preset file on this PC (`profileKit.presetPath`), or '' for none. Used only without a synced preset. */
  presetPath(): string {
    return vscode.workspace.getConfiguration('profileKit').get<string>('presetPath', '').trim();
  }

  /** Where the preset comes from: the synced setting `profileKit.preset` first, then the file on this PC. */
  presetSource(): PresetSource | undefined {
    return presetSourceFrom(readSyncedPreset(), this.presetPath());
  }

  hasPreset(): boolean {
    return !!this.presetSource();
  }

  /** The preset stored in Settings (and carried by Settings Sync) is the one in use. */
  presetInSettings(): boolean {
    return this.presetSource()?.kind === 'settings';
  }

  /** For messages and the tree: the file path, or "Settings (Sync)". */
  presetLabel(): string {
    const source = this.presetSource();
    if (!source) return '';
    return source.kind === 'settings' ? vscode.l10n.t('Settings (synced)') : source.file;
  }

  /**
   * Use this preset file from now on (application scope: one value for every profile) and load it. A synced preset
   * would still win over the file, so it is removed first, after asking and with a copy in global storage.
   * Returns false when the user keeps the synced preset.
   */
  async usePreset(file: string): Promise<boolean> {
    const synced = readSyncedPreset();
    if (synced) {
      const use = vscode.l10n.t('Use the File');
      const answer = await vscode.window.showWarningMessage(
        vscode.l10n.t('Use {0} instead of the preset stored in Settings?', file),
        {
          modal: true,
          detail: vscode.l10n.t(
            'The synced preset is removed from Settings, and Settings Sync removes it on your other PCs too. A copy is kept in {0}.',
            vscode.Uri.joinPath(this.context.globalStorageUri, 'synced-preset-backups').fsPath,
          ),
        },
        use,
      );
      if (answer !== use) return false;
      await this.backupSyncedPreset(synced);
      await writeSyncedPreset(undefined);
    }
    await vscode.workspace.getConfiguration('profileKit').update('presetPath', file, vscode.ConfigurationTarget.Global);
    await this.loadPreset();
    await this.refresh();
    return true;
  }

  private async backupSyncedPreset(value: Record<string, unknown>): Promise<void> {
    const dir = vscode.Uri.joinPath(this.context.globalStorageUri, 'synced-preset-backups');
    await vscode.workspace.fs.createDirectory(dir);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(/[-:]/g, '');
    const target = vscode.Uri.joinPath(dir, `synced-preset-${stamp}.profile-kit.json`);
    await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(syncedPresetText(value)));
    this.log(`synced preset backed up: ${target.fsPath}`);
  }

  /** Extensions installed in this window's profile, lower-case, without VS Code's built-in ones and Profile Kit. */
  userExtensionIds(): string[] {
    const builtinRoot = vscode.env.appRoot.toLowerCase();
    return vscode.extensions.all
      .filter((e) => !e.extensionPath.toLowerCase().startsWith(builtinRoot) && e.id.toLowerCase() !== this.ownId)
      .map((e) => e.id.toLowerCase());
  }

  /**
   * Read the preset (the synced one, or the file named by `profileKit.presetPath`) and watch the file. Does not call
   * the code CLI. A synced preset is reloaded from onDidChangeConfiguration (extension.ts).
   */
  async loadPreset(): Promise<void> {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.loaded = undefined;
    this.loadError = undefined;
    this.presetMissing = false;
    const source = this.presetSource();
    if (source?.kind === 'settings') {
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(SYNCED_PRESET_URI));
        this.loaded = { uri: SYNCED_PRESET_URI, text, preset: parsePresetText(text) };
      } catch (error) {
        this.loadError = error instanceof Error ? error.message : String(error);
      }
    } else if (source) {
      const file = source.file;
      const uri = vscode.Uri.file(file);
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
        this.loaded = { uri, text, preset: parsePresetText(text) };
      } catch (error) {
        // the path is per PC (profileKit.presetPath is not synced); say so instead of a raw file system error
        this.presetMissing = error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
        this.loadError = this.presetMissing
          ? vscode.l10n.t(
              'The preset file is not on this PC: {0}. Open the preset where it is on this PC (for example, your clone of the repository).',
              file,
            )
          : error instanceof PresetError || error instanceof Error
            ? error.message
            : String(error);
      }
      this.watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)),
      );
      const reload = () => void this.loadPreset();
      this.watcher.onDidChange(reload);
      this.watcher.onDidCreate(reload);
      this.watcher.onDidDelete(reload);
    }
    await vscode.commands.executeCommand('setContext', 'profileKit.hasPreset', !!source);
    await vscode.commands.executeCommand('setContext', 'profileKit.presetInSettings', source?.kind === 'settings');
    this.changed.fire();
  }

  private suggestion: { folder: string; profile: string; matched: string[] } | undefined;

  /** The profile the preset suggests for this window's folder (`match.files`), set by FolderAdvisor. */
  get folderSuggestion(): { folder: string; profile: string; matched: string[] } | undefined {
    return this.suggestion;
  }

  setFolderSuggestion(s: { folder: string; profile: string; matched: string[] } | undefined): void {
    this.suggestion = s;
    this.changed.fire();
  }

  /**
   * Re-read storage.json and what is installed in every profile, Default included. The lists come from VS Code's own
   * files (listProfile), so this starts no `code` process and every window can know every profile from its start.
   * Before 1.5 each list was a `code` process: a window listed its own profile only until a view showed them all,
   * at most 3 at once (review P5).
   */
  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        this.storage = readStorage(this.paths);
        await this.readExtensionsFolder();
        const names = [DEFAULT_PROFILE, ...this.storage.profiles.map((p) => p.name)];
        for (const name of [...this.installed.keys()]) if (!names.includes(name)) this.installed.delete(name);
        // one after the other: a profile that needs the CLI (listProfile) is then one `code` process at a time
        for (const name of names) this.installed.set(name, await this.listProfile(name));
      } finally {
        this.refreshing = undefined;
        this.changed.fire();
      }
    })();
    return this.refreshing;
  }

  /** What every profile shares: extensions applied to all profiles, and what the installed ones need or bundle. */
  private async readExtensionsFolder(): Promise<void> {
    this.applicationScoped = new Set(readApplicationScoped(this.extensionsDir).ids);
    this.relations = await readExtensionRelations(this.extensionsDir, this.manifests).catch(() => new Map());
  }

  private readonly listProblems = new Set<string>();

  /**
   * What is installed in a profile: read from VS Code's own lists (host/builtins.ts readInstalledExtensions), which
   * takes no `code` process. When they cannot be read or understood, `code --list-extensions` says, as before 1.5.
   * Undefined for a profile that does not exist, or when neither way gave a list. Default is only read from its
   * list: Profile Kit does not manage it, and its list is only used to tell what is new in a Default window.
   */
  private async listProfile(name: string): Promise<string[] | undefined> {
    const stored = this.storage.profiles.find((p) => p.name === name);
    if (!stored)
      return name === DEFAULT_PROFILE ? readInstalledExtensions(this.paths, this.extensionsDir).ids : undefined;
    const read = readInstalledExtensions(this.paths, this.extensionsDir, stored);
    if (read.ids) return read.ids;
    const note = `${name}: ${read.problem}; asking the code CLI instead`;
    if (!this.listProblems.has(note)) {
      this.listProblems.add(note);
      this.log(`! ${note}`);
    }
    return listInstalled(this.run, name).catch(() => undefined);
  }

  /** Re-read storage.json only (cheap; used while waiting for a new profile). */
  refreshStorage(): StoredProfile[] {
    this.storage = readStorage(this.paths);
    return this.storage.profiles;
  }

  private readonly installingIds = new Map<string, number>();

  /** Remember that Profile Kit itself installs `id` now, so the "you installed X" prompt (M4) skips it. */
  markInstalling(id: string): void {
    this.installingIds.set(id.toLowerCase(), Date.now());
  }

  /** True when Profile Kit installed `id` in the last few minutes. */
  installedByKit(id: string, withinMs = 10 * 60_000): boolean {
    const at = this.installingIds.get(id.toLowerCase());
    return at !== undefined && Date.now() - at < withinMs;
  }

  /**
   * Extensions VS Code applies to all profiles ("Apply Extension to all Profiles", Default's extensions.json).
   * They are in every profile's installed list.
   */
  appliedToAll(id: string): boolean {
    return this.applicationScoped.has(id.toLowerCase());
  }

  /**
   * What is installed in a profile (`Default` for the Default profile), as last read; undefined when not read yet
   * or the profile does not exist.
   */
  installedIn(name: string): readonly string[] | undefined {
    return this.installed.get(name);
  }

  /** What installed extensions need or bundle, by ID: every profile's, from the package.json files on disk. */
  get extensionRelations(): ReadonlyMap<string, ExtensionRelations> {
    return this.relations;
  }

  /**
   * Read one profile again (after installing into it, after this window's extensions changed), and the extensions
   * folder with it: what was just installed has new manifests. Unlike refresh, a call never shares the reads of one
   * that is already running, so what it leaves is at least as new as the call.
   */
  async refreshProfile(name: string): Promise<void> {
    this.storage = readStorage(this.paths);
    await this.readExtensionsFolder();
    this.installed.set(name, await this.listProfile(name));
    this.changed.fire();
  }

  declaredNames(): string[] {
    return this.loaded ? profileNames(this.loaded.preset) : [];
  }

  /** Declared profiles by state: not created, missing extensions, not listed yet, ok. */
  status(): PresetStatus {
    return presetStatus(
      this.rows().map((r) => ({
        name: r.name,
        declared: r.declared,
        exists: !!r.stored,
        ...(r.diff ? { missing: r.diff.missing.length } : {}),
      })),
    );
  }

  /** Declared profiles first (preset order), then profiles only VS Code knows. */
  rows(): ProfileRow[] {
    const preset = this.loaded?.preset;
    const declared = this.declaredNames();
    const rows: ProfileRow[] = declared.map((name) => {
      const stored = this.storage.profiles.find((p) => p.name === name);
      const installed = this.installed.get(name);
      return {
        name,
        declared: true,
        ...(stored ? { stored } : {}),
        ...(installed ? { installed } : {}),
        ...(stored && installed && preset ? this.diffOf(preset, name, installed) : {}),
      };
    });
    for (const stored of this.storage.profiles)
      if (!declared.includes(stored.name)) {
        const installed = this.installed.get(stored.name);
        rows.push({ name: stored.name, declared: false, stored, ...(installed ? { installed } : {}) });
      }
    return rows;
  }

  /**
   * Declared vs installed, and why extras are there. Profile Kit itself is not an "extra" the user has to think
   * about, but it still counts as present when the preset declares it.
   */
  private diffOf(
    preset: Preset,
    name: string,
    installed: readonly string[],
  ): { diff: ExtensionDiff; extraReasons: ReadonlyMap<string, ExtraReason> } {
    const diff = diffExtensions(resolveProfile(preset, name), installed, { ignoreExtra: [this.ownId] });
    return { diff, extraReasons: explainExtras(diff.extra, installed, this.relations) };
  }

  /**
   * The profile this window runs in. Primary: the `profileKit.profile` marker Profile Kit writes into each
   * profile's settings.json (PLAN.md section 8, #3). Fallback: the folder → profile link in storage.json.
   */
  currentProfile(): { name: string; how: 'marker' | 'folder' } | undefined {
    const marker = vscode.workspace.getConfiguration('profileKit').get<string>('profile', '').trim();
    if (marker) return { name: marker, how: 'marker' };
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.toString();
    const link = folder ? folderProfile(this.storage, folder) : undefined;
    return link?.profile ? { name: link.profile, how: 'folder' } : undefined;
  }

  log(line: string): void {
    this.output.appendLine(line);
  }

  private readonly changes = new OneAtATime();
  private changeEndedAt = 0;

  /**
   * A change by Profile Kit runs in this window, or ended a moment ago (VS Code reports the last installs a little
   * after the `code` call has returned). Extensions that show up in this window's profile meanwhile came with that
   * change, including the dependencies and pack members VS Code adds by itself, which markInstalling never sees.
   */
  changeRunning(graceMs = 5000): boolean {
    return this.changes.current !== undefined || Date.now() - this.changeEndedAt < graceMs;
  }

  /**
   * Run a change (apply, installs, preset edits that install) unless another one still runs in this window; then say
   * what runs and return undefined. Covers the whole change, from reading profiles to the result, so a second click
   * while the first is still reading does not start the same installs again.
   */
  async exclusive<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    const result = await this.changes.run(label, async () => {
      try {
        return await fn();
      } finally {
        this.changeEndedAt = Date.now();
      }
    });
    if (result.ran) return result.value;
    const showOutput = vscode.l10n.t('Show Output');
    void vscode.window
      .showInformationMessage(
        vscode.l10n.t('Profile Kit is still busy: {0}. Try again when it has finished.', result.running),
        showOutput,
      )
      .then((a) => a === showOutput && this.output.show(true));
    return undefined;
  }

  dispose(): void {
    this.watcher?.dispose();
    this.changed.dispose();
    this.output.dispose();
  }
}
