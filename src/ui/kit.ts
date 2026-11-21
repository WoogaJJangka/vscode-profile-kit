/**
 * Shared state of the extension: where things are, how to call the `code` CLI, the loaded preset, and the
 * per-profile status (declared vs installed) that the tree and the status bar show.
 */
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  type CodeRunner,
  createCodeRunner,
  diffExtensions,
  type ExtensionDiff,
  folderProfile,
  parsePresetText,
  type Preset,
  PresetError,
  profileNames,
  resolveProfile,
  type StorageProfiles,
  type StoredProfile,
} from '../core';
import { readStorage } from '../host/apply';
import { findCodeCli } from '../host/codeLocator';
import { listInstalled } from '../host/installer';
import { defaultUserDataDir, userDataDirFromGlobalStorage, userDataPaths, type UserDataPaths } from '../host/paths';

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
  /** `--list-extensions`; undefined while unknown or when the profile does not exist. */
  installed?: string[];
  /** Declared profiles that exist. */
  diff?: ExtensionDiff;
  error?: string;
}

export const DEFAULT_PROFILE = 'Default';

/** The extension's view of the world. One instance per window. */
export class Kit implements vscode.Disposable {
  readonly output = vscode.window.createOutputChannel('Profile Kit');
  readonly paths: UserDataPaths;
  readonly run: CodeRunner;
  readonly codeCli: string | undefined;

  private loaded: LoadedPreset | undefined;
  private loadError: string | undefined;
  private storage: StorageProfiles = { profiles: [], folders: [], emptyWindows: [], problems: [] };
  private installed = new Map<string, string[] | undefined>();
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
    const { baseArgs, windowsBlocked } = this.codeBaseArgs(userData);
    this.windowsBlocked = windowsBlocked;
    this.run = createCodeRunner(this.codeCli ?? 'code', { baseArgs, timeoutMs: 5 * 60_000 });
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
  private codeBaseArgs(userData: string): { baseArgs: string[]; windowsBlocked: string | undefined } {
    const same = (a: string, b: string) =>
      process.platform === 'win32' || process.platform === 'darwin'
        ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
        : path.resolve(a) === path.resolve(b);
    const args: string[] = [];
    if (!same(userData, defaultUserDataDir())) args.push('--user-data-dir', userData);
    const extDir = path.dirname(this.context.extensionPath);
    const defaultExtDir = path.join(process.env.VSCODE_PORTABLE ?? path.join(os.homedir(), '.vscode'), 'extensions');
    if (existsSync(path.join(extDir, 'extensions.json')) && !same(extDir, defaultExtDir))
      args.push('--extensions-dir', extDir);
    let extra: string[] = [];
    try {
      const parsed: unknown = JSON.parse(process.env.PROFILE_KIT_CODE_ARGS ?? '[]');
      if (Array.isArray(parsed)) extra = parsed.filter((a): a is string => typeof a === 'string');
    } catch {
      // ignore a malformed test variable
    }
    const custom = args.length > 0;
    const windowsBlocked =
      custom && !extra.includes('--shared-data-dir')
        ? vscode.l10n.t(
            'This VS Code runs with its own data folders, so Profile Kit cannot open windows for it safely (a window could start a second VS Code that signs you out). Create the profile in VS Code first (Profiles editor), then try again.',
          )
        : undefined;
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

  presetPath(): string {
    return vscode.workspace.getConfiguration('profileKit').get<string>('presetPath', '').trim();
  }

  /** Read the preset file named by `profileKit.presetPath` and watch it. Does not call the code CLI. */
  async loadPreset(): Promise<void> {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.loaded = undefined;
    this.loadError = undefined;
    this.presetMissing = false;
    const file = this.presetPath();
    if (file) {
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
    await vscode.commands.executeCommand('setContext', 'profileKit.hasPreset', !!file);
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

  /** Re-read storage.json and every profile's `--list-extensions` (in parallel). */
  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        this.storage = readStorage(this.paths);
        const names = new Set([...this.storage.profiles.map((p) => p.name), ...this.declaredNames()]);
        const lists = await Promise.all(
          [...names].map(async (name) => {
            const exists = this.storage.profiles.some((p) => p.name === name);
            return [name, exists ? await listInstalled(this.run, name).catch(() => undefined) : undefined] as const;
          }),
        );
        this.installed = new Map(lists);
      } finally {
        this.refreshing = undefined;
        this.changed.fire();
      }
    })();
    return this.refreshing;
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

  /** Re-list one profile only (after installing into it). */
  async refreshProfile(name: string): Promise<void> {
    this.storage = readStorage(this.paths);
    this.installed.set(name, await listInstalled(this.run, name).catch(() => undefined));
    this.changed.fire();
  }

  declaredNames(): string[] {
    return this.loaded ? profileNames(this.loaded.preset) : [];
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
        // Profile Kit itself is not an "extra" the user has to think about
        ...(stored && installed && preset
          ? {
              diff: diffExtensions(
                resolveProfile(preset, name),
                installed.filter((id) => id !== this.ownId),
              ),
            }
          : {}),
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

  dispose(): void {
    this.watcher?.dispose();
    this.changed.dispose();
    this.output.dispose();
  }
}
