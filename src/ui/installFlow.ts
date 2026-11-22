/**
 * Adding an extension to profiles from the GUI:
 * - after the user installs an extension the normal way, a notification offers to add it to other profiles
 *   (extensions.onDidChange fires only for this window's profile, PLAN.md section 8, #6)
 * - the "Install to Profiles..." command does the same for any extension ID, using Marketplace data for suggestions
 * Both pick profiles (suggested ones pre-checked), choose where the preset records it, update the preset file,
 * then install into the chosen profiles that exist.
 */
import * as vscode from 'vscode';

import {
  addExtension,
  compareCodeUnits,
  CORE_TARGET,
  type ExtensionMeta,
  extensionMetaFromManifest,
  isExtensionId,
  normalizeId,
  parsePresetText,
  profilesWithExtension,
  type Recommendation,
  recommendProfiles,
  recordOptions,
  type RecordOption,
} from '../core';
import { installExtensions, installSucceeded } from '../host/installer';
import { queryGallery } from '../host/marketplace';
import type { Kit } from './kit';

const t = vscode.l10n.t;
const IGNORED_KEY = 'profileKit.ignoredExtensions';
/** Which window asks about which extension: shared by the windows of a profile (review P6). */
const PROMPTS_KEY = 'profileKit.installPrompts';
const PROMPT_CLAIM_MS = 10 * 60_000;
/** Time for a claim written by another window to arrive in this one's globalState. */
const CLAIM_SETTLE_MS = 1500;

type PromptClaims = Record<string, { by: string; at: number }>;

function localExtensionIds(kit: Kit): Set<string> {
  const builtin = vscode.env.appRoot.toLowerCase();
  const own = kit.context.extension.id.toLowerCase();
  return new Set(
    vscode.extensions.all
      .filter((e) => !e.extensionPath.toLowerCase().startsWith(builtin))
      .map((e) => e.id.toLowerCase())
      .filter((id) => id !== own),
  );
}

function knownMetas(): ExtensionMeta[] {
  return vscode.extensions.all.map((e) => extensionMetaFromManifest(e.id, e.packageJSON));
}

function displayName(id: string): string {
  const pkg = vscode.extensions.getExtension(id)?.packageJSON as { displayName?: unknown } | undefined;
  return typeof pkg?.displayName === 'string' && !pkg.displayName.startsWith('%') ? pkg.displayName : id;
}

const targetLabel = (profile: string) => (profile === CORE_TARGET ? t('every profile (core)') : profile);

/** Watches this window's extensions and asks about ones the user installed themselves. */
export class InstallWatcher implements vscode.Disposable {
  private snapshot: Set<string>;
  private readonly subscription: vscode.Disposable;

  constructor(private readonly kit: Kit) {
    this.snapshot = localExtensionIds(kit);
    this.subscription = vscode.extensions.onDidChange(() => void this.check());
  }

  private async check(): Promise<void> {
    const now = localExtensionIds(this.kit);
    const added = [...now].filter((id) => !this.snapshot.has(id));
    this.snapshot = now;
    // the profile's last `--list-extensions`, read before it is refreshed for this change: it also has disabled
    // extensions, so one that was only enabled again is not taken for a new install (review P6)
    const current = this.kit.currentProfile()?.name;
    const before = new Set(current ? (this.kit.installedIn(current) ?? []) : []);
    const preset = this.kit.preset?.preset;
    if (!preset) return;
    const ignored = new Set(this.kit.context.globalState.get<string[]>(IGNORED_KEY, []));
    for (const id of added) {
      if (this.kit.installedByKit(id) || ignored.has(id) || before.has(id)) continue;
      // already declared somewhere: the tree shows where it is missing, nothing to ask
      if (profilesWithExtension(preset, id).length) continue;
      if (!(await this.claim(id))) continue;
      await this.ask(id);
    }
  }

  /**
   * Every window of this profile sees the same install. Each writes "I ask about `id`" into globalState (shared
   * by those windows), waits for the others' writes to arrive, and only the window whose claim is still there asks.
   */
  private async claim(id: string): Promise<boolean> {
    const state = this.kit.context.globalState;
    const me = vscode.env.sessionId;
    const now = Date.now();
    const fresh = Object.fromEntries(
      Object.entries(state.get<PromptClaims>(PROMPTS_KEY, {})).filter(([, c]) => now - c.at < PROMPT_CLAIM_MS),
    );
    const prior = fresh[id];
    if (prior && prior.by !== me) return false;
    await state.update(PROMPTS_KEY, { ...fresh, [id]: { by: me, at: now } });
    await new Promise((r) => setTimeout(r, CLAIM_SETTLE_MS));
    return state.get<PromptClaims>(PROMPTS_KEY, {})[id]?.by === me;
  }

  private async ask(id: string): Promise<void> {
    const preset = this.kit.preset?.preset;
    if (!preset) return;
    const meta = extensionMetaFromManifest(id, vscode.extensions.getExtension(id)?.packageJSON);
    const recs = recommendProfiles(meta, preset, knownMetas()).filter((r) => r.score > 0);
    const current = this.kit.currentProfile()?.name;
    const declaredHere = !!current && current in preset.profiles;
    const name = displayName(id);
    const where = current ?? t('this profile');
    let message = t('{0} was installed in {1}. Add it to other profiles too?', name, where);
    if (recs.length) message += ` ${t('Suggested: {0}.', recs.map((r) => targetLabel(r.profile)).join(', '))}`;

    const choose = t('Choose Profiles...');
    const onlyHere = t('Only {0}', where);
    const never = t("Don't Ask for This One");
    const answer = await vscode.window.showInformationMessage(
      message,
      choose,
      ...(declaredHere ? [onlyHere] : []),
      never,
    );
    if (answer === choose) await addToProfiles(this.kit, id, meta, { installedIn: current });
    else if (answer === onlyHere && current)
      await addToProfiles(this.kit, id, meta, { installedIn: current, chosen: [current] });
    else if (answer === never) {
      const list = this.kit.context.globalState.get<string[]>(IGNORED_KEY, []);
      await this.kit.context.globalState.update(IGNORED_KEY, [...new Set([...list, id])]);
    }
  }

  dispose(): void {
    this.subscription.dispose();
  }
}

interface TargetPick extends vscode.QuickPickItem {
  profile: string;
}

async function pickProfiles(
  kit: Kit,
  id: string,
  recs: Recommendation[],
  installedIn?: string,
): Promise<string[] | undefined> {
  const rows = new Map(kit.rows().map((r) => [r.name, r]));
  const declaredIn = new Set(kit.preset ? profilesWithExtension(kit.preset.preset, id) : []);
  const items: TargetPick[] = recs.map((r) => {
    const row = rows.get(r.profile);
    const notes = [
      r.profile === installedIn ? t('installed here') : '',
      declaredIn.has(r.profile) ? t('already in the preset') : '',
      r.profile !== CORE_TARGET && !row?.stored ? t('not created yet') : '',
      r.score > 0 ? t('suggested') : '',
    ].filter(Boolean);
    return {
      profile: r.profile,
      label: r.profile === CORE_TARGET ? `$(globe) ${t('All profiles (core)')}` : `$(layers) ${r.profile}`,
      description: notes.join(' · '),
      ...(r.reasons.length ? { detail: r.reasons.join('; ') } : {}),
      picked: r.score > 0 || r.profile === installedIn || declaredIn.has(r.profile),
    };
  });
  // core first, so "all profiles" is easy to find
  items.sort((a, b) => Number(b.profile === CORE_TARGET) - Number(a.profile === CORE_TARGET));
  const picked = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: t('Add {0} to profiles', displayName(id)),
    placeHolder: t('Suggested profiles are checked. The preset file is updated, then the extension is installed.'),
    matchOnDetail: true,
  });
  return picked?.map((p) => p.profile);
}

/** Where the preset records it, for the result message. */
function recordLabel(option: RecordOption): string {
  if (option.kind === 'core') return t('core (every profile)');
  if (option.kind === 'group') return t('group "{0}"', option.group ?? '');
  return t("each profile's own extensions");
}

export interface AddOptions {
  /** Profile where it is already installed (this window's). */
  installedIn?: string;
  /** Skip the profile picker. */
  chosen?: string[];
}

/** Choose profiles, record the extension in the preset, install where needed. */
export async function addToProfiles(
  kit: Kit,
  id: string,
  meta: ExtensionMeta,
  options: AddOptions = {},
): Promise<void> {
  const loaded = kit.preset;
  if (!loaded) {
    void vscode.window.showWarningMessage(kit.presetError ?? t('No preset file is set.'));
    return;
  }
  const recs = recommendProfiles(meta, loaded.preset, knownMetas());
  const chosen = options.chosen ?? (await pickProfiles(kit, id, recs, options.installedIn));
  if (!chosen?.length) return;
  // no second question (1.1.0): the first option gives it to exactly the chosen profiles, preferring core or a
  // group that matches them, else each profile's own list (core/addExtension.ts). The result message says which.
  const option = recordOptions(loaded.preset, chosen)[0];
  if (!option) return;

  // the preset is the source of truth: write it first
  const dirty = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === loaded.uri.fsPath && d.isDirty);
  if (dirty) {
    void vscode.window.showWarningMessage(t('Save or revert the preset file first; it has unsaved changes.'));
    return;
  }
  let text = loaded.text;
  for (const target of option.targets) text = addExtension(text, target, id);
  const updated = parsePresetText(text);
  if (text !== loaded.text) await vscode.workspace.fs.writeFile(loaded.uri, new TextEncoder().encode(text));
  await kit.loadPreset();

  // install into every declared profile that should have it and exists but lacks it
  const want = normalizeId(id);
  const rows = new Map(kit.rows().map((r) => [r.name, r]));
  const targets = profilesWithExtension(updated, id);
  const notCreated = targets.filter((p) => !rows.get(p)?.stored);
  const toInstall = targets.filter((p) => {
    const row = rows.get(p);
    return row?.stored && p !== options.installedIn && !(row.installed ?? []).includes(want);
  });
  kit.log(
    `== add ${id}: recorded in ${option.targets.map((x) => (x.kind === 'core' ? 'core' : `${x.kind} ${x.name}`)).join(', ')}; install into ${toInstall.join(', ') || '(none)'}`,
  );

  const failed: string[] = [];
  if (toInstall.length)
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: t('Installing {0}', displayName(id)),
        cancellable: true,
      },
      async (progress, token) => {
        for (const [i, profile] of toInstall.entries()) {
          if (token.isCancellationRequested) break;
          progress.report({ message: `${profile} (${i + 1}/${toInstall.length})`, increment: 100 / toInstall.length });
          kit.markInstalling(id);
          const [result] = await installExtensions(kit.run, profile, [id]);
          kit.log(`  ${profile}: ${result?.outcome ?? 'skipped'}${result?.detail ? ` ${result.detail}` : ''}`);
          if (!result || !installSucceeded(result.outcome)) failed.push(profile);
        }
      },
    );
  await kit.refresh();

  const parts = [
    t('{0} is now in the preset for: {1}.', displayName(id), targets.join(', ')),
    text === loaded.text ? '' : t('Recorded under {0}.', recordLabel(option)),
    toInstall.length ? t('Installed in {0} profile(s).', toInstall.length - failed.length) : '',
    failed.length ? t('Failed in: {0}.', failed.join(', ')) : '',
    notCreated.length ? t('Not created yet (apply the preset to create them): {0}.', notCreated.join(', ')) : '',
  ].filter(Boolean);
  const showOutput = t('Show Output');
  void (
    failed.length
      ? vscode.window.showWarningMessage(parts.join(' '), showOutput)
      : vscode.window.showInformationMessage(parts.join(' '), showOutput)
  ).then((a) => a === showOutput && kit.output.show(true));
}

interface ExtensionPick extends vscode.QuickPickItem {
  id?: string;
}

/** "Install to Profiles...": any extension ID, suggestions from its manifest or Marketplace data. */
export async function installToProfiles(kit: Kit, arg?: unknown): Promise<void> {
  if (!kit.preset) {
    void vscode.window.showWarningMessage(kit.presetError ?? t('No preset file is set.'));
    return;
  }
  let id = typeof arg === 'string' && isExtensionId(arg) ? arg.toLowerCase() : undefined;
  if (!id) {
    const local = [...localExtensionIds(kit)].sort(compareCodeUnits);
    const items: ExtensionPick[] = [
      { label: `$(edit) ${t('Enter an extension ID...')}`, description: t('publisher.name, as on the Marketplace') },
      { label: t('Installed in this profile'), kind: vscode.QuickPickItemKind.Separator },
      ...local.map((x) => ({ id: x, label: displayName(x), description: x })),
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: t('Install to Profiles'),
      matchOnDescription: true,
    });
    if (!picked) return;
    id =
      picked.id ??
      (
        await vscode.window.showInputBox({
          title: t('Install to Profiles'),
          prompt: t('Extension ID (publisher.name)'),
          placeHolder: 'ms-python.python',
          validateInput: (v) => (isExtensionId(v.trim()) ? undefined : t('Use publisher.name, e.g. ms-python.python')),
        })
      )
        ?.trim()
        .toLowerCase();
    if (!id) return;
  }

  let meta: ExtensionMeta;
  const installed = vscode.extensions.getExtension(id);
  if (installed) meta = extensionMetaFromManifest(id, installed.packageJSON);
  else {
    const extId = id;
    const found = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: t('Looking up {0} on the Marketplace', extId) },
      () =>
        queryGallery([extId]).catch((error: unknown) => {
          // offline or blocked: carry on with the ID alone
          kit.log(`! Marketplace lookup failed: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        }),
    );
    if (found && !found.has(extId)) {
      void vscode.window.showErrorMessage(t('{0} was not found on the Marketplace.', extId));
      return;
    }
    meta = found?.get(extId) ?? { id: extId };
  }
  await addToProfiles(kit, id, meta, {
    ...(kit.currentProfile() && installed ? { installedIn: kit.currentProfile()?.name } : {}),
  });
}
