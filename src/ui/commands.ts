/**
 * Commands behind the tree, the view toolbar and the command palette.
 * Everything that changes something shows what it will do first and asks (modal) before doing it.
 */
import * as path from 'node:path';

import * as vscode from 'vscode';

import { formatPlan, planIsEmpty, profileNames, resolveProfile } from '../core';
import { buildPlans, executePlans, type ProfileReport, reportOk } from '../host/apply';
import { ensureProfile, installExtensions, type InstallResult, installSucceeded } from '../host/installer';
import { DEFAULT_PROFILE, type Kit } from './kit';
import { switchProfile } from './switch';
import type { ProfileNode } from './tree';

const t = vscode.l10n.t;

function profileOf(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && (arg as ProfileNode).kind === 'profile') return (arg as ProfileNode).row.name;
  return undefined;
}

async function pickDeclared(kit: Kit, title: string, filter?: (name: string) => boolean): Promise<string | undefined> {
  const names = kit.declaredNames().filter((n) => !filter || filter(n));
  if (!names.length) {
    void vscode.window.showInformationMessage(t('No profile to pick.'));
    return undefined;
  }
  return vscode.window.showQuickPick(names, { title });
}

function requirePreset(kit: Kit) {
  const loaded = kit.preset;
  if (!loaded) {
    void vscode.window
      .showWarningMessage(kit.presetError ?? t('No preset file is set.'), t('Open Preset File...'))
      .then((a) => a && vscode.commands.executeCommand('profileKit.openPreset'));
  }
  return loaded;
}

function summarize(results: readonly InstallResult[]): { ok: number; failed: InstallResult[] } {
  const ok = results.filter((r) => installSucceeded(r.outcome)).length;
  return { ok, failed: results.filter((r) => !installSucceeded(r.outcome)) };
}

function logReports(kit: Kit, reports: readonly ProfileReport[]): void {
  kit.log('== Result ==');
  for (const r of reports) {
    const { ok, failed } = summarize(r.installs);
    kit.log(
      `${reportOk(r) ? 'ok  ' : 'FAIL'} ${r.name}: ${r.created ? 'created, ' : ''}${ok}/${r.installs.length} installed, ${r.settingsChanged} setting(s)${r.backup ? `, backup ${r.backup}` : ''}`,
    );
    for (const f of failed)
      kit.log(`     ${f.id}: ${f.outcome}${f.detail ? `\n       ${f.detail.replace(/\n/g, '\n       ')}` : ''}`);
    for (const p of r.problems) kit.log(`     ${p}`);
  }
}

async function confirmCreate(name: string): Promise<boolean> {
  const create = t('Create Profile');
  const answer = await vscode.window.showWarningMessage(
    t('Profile "{0}" does not exist yet.', name),
    { modal: true, detail: t('VS Code can only create a profile by opening a window in it, so a new window opens.') },
    create,
  );
  return answer === create;
}

/** Install the declared-but-missing extensions of one profile (creating the profile first if needed). */
async function installMissing(kit: Kit, arg: unknown): Promise<void> {
  const loaded = requirePreset(kit);
  if (!loaded) return;
  const name =
    profileOf(arg) ??
    (await pickDeclared(kit, t('Install missing extensions into...'), (n) => {
      const row = kit.rows().find((r) => r.name === n);
      return !row?.stored || !!row.diff?.missing.length;
    }));
  if (!name) return;
  const row = kit.rows().find((r) => r.name === name);
  const ids = row?.diff ? row.diff.missing : resolveProfile(loaded.preset, name);
  if (!ids.length) {
    void vscode.window.showInformationMessage(t('"{0}" has every declared extension.', name));
    return;
  }
  if (!row?.stored && kit.windowsBlocked) {
    void vscode.window.showWarningMessage(kit.windowsBlocked);
    return;
  }
  if (!row?.stored && !(await confirmCreate(name))) return;

  const results = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('Profile Kit: {0}', name), cancellable: true },
    async (progress, token) => {
      if (!row?.stored) {
        progress.report({ message: t('creating the profile...') });
        const ensured = await ensureProfile(kit.run, name, () => kit.refreshStorage());
        if (ensured.status === 'timeout') throw new Error(t('Profile "{0}" was not created in time.', name));
      }
      kit.log(`== install into ${name}: ${ids.join(', ')}`);
      return installExtensions(kit.run, name, ids, {
        shouldStop: () => token.isCancellationRequested,
        onProgress: (id, i, n) => {
          kit.markInstalling(id);
          progress.report({ message: `${id} (${i + 1}/${n})`, increment: 100 / n });
        },
      });
    },
  );
  for (const r of results) kit.log(`  ${r.id}: ${r.outcome} (${r.attempts} try)${r.detail ? ` ${r.detail}` : ''}`);
  await kit.refreshProfile(name);
  const { ok, failed } = summarize(results);
  const showOutput = t('Show Output');
  const message =
    failed.length || results.length < ids.length
      ? t(
          '{0}: {1} installed, {2} failed, {3} not tried. Network errors were retried.',
          name,
          ok,
          failed.length,
          ids.length - results.length,
        )
      : t('{0}: {1} extension(s) installed.', name, ok);
  const show = failed.length
    ? vscode.window.showWarningMessage(message, showOutput)
    : vscode.window.showInformationMessage(message, showOutput);
  void show.then((a) => a === showOutput && kit.output.show(true));
}

/** Full apply (create, install, settings) for some declared profiles, after a preview and a modal confirm. */
async function apply(kit: Kit, names: string[]): Promise<void> {
  const loaded = requirePreset(kit);
  if (!loaded || !names.length) return;
  const env = { run: kit.run, paths: kit.paths };
  const { plans, problems } = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: t('Profile Kit: reading profiles...') },
    () => buildPlans(env, loaded.preset, names),
  );
  kit.output.clear();
  kit.log(`Preset: ${loaded.uri.fsPath}`);
  for (const p of problems) kit.log(`! ${p}`);
  for (const line of formatPlan(plans)) kit.log(line);
  const todo = plans.filter((p) => !planIsEmpty(p));
  if (!todo.length) {
    void vscode.window.showInformationMessage(t('Everything is up to date.'));
    return;
  }
  kit.output.show(true);
  const installs = todo.reduce((n, p) => n + p.extensions.missing.length, 0);
  const settings = todo.reduce((n, p) => n + (p.settings?.changes.length ?? 0), 0);
  const creates = todo.filter((p) => p.create).map((p) => p.name);
  const overrides = todo.flatMap((p) =>
    (p.settings?.changes ?? []).filter((c) => c.overridesUser).map((c) => `${p.name}: ${c.key}`),
  );
  const detail = [
    t('Profiles: {0}', todo.map((p) => p.name).join(', ')),
    t(
      '{0} extension(s) to install, {1} setting(s) to write (settings.json files are backed up first).',
      installs,
      settings,
    ),
    creates.length
      ? kit.windowsBlocked
        ? t('Not created (create them in VS Code first): {0}', creates.join(', '))
        : t('New profiles (each opens a window): {0}', creates.join(', '))
      : '',
    overrides.length ? t('These replace values you set yourself: {0}', overrides.join(', ')) : '',
    t('Nothing is uninstalled and the Default profile is not changed. The full list is in the Output panel.'),
  ]
    .filter(Boolean)
    .join('\n\n');
  const go = t('Apply');
  if ((await vscode.window.showWarningMessage(t('Apply the preset?'), { modal: true, detail }, go)) !== go) return;

  const reports = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('Profile Kit'), cancellable: true },
    (progress, token) =>
      executePlans(env, loaded.preset, todo, {
        createProfiles: !kit.windowsBlocked,
        ...(kit.windowsBlocked ? { createBlockedReason: kit.windowsBlocked } : {}),
        install: { shouldStop: () => token.isCancellationRequested, onProgress: (id) => kit.markInstalling(id) },
        onEvent: (m) => {
          kit.log(m);
          progress.report({ message: m });
        },
      }),
  );
  logReports(kit, reports);
  await kit.refresh();
  const bad = reports.filter((r) => !reportOk(r));
  const showOutput = t('Show Output');
  const message = bad.length
    ? t('Applied with problems in: {0}', bad.map((r) => r.name).join(', '))
    : t('Preset applied to {0} profile(s).', reports.length);
  void (
    bad.length
      ? vscode.window.showWarningMessage(message, showOutput)
      : vscode.window.showInformationMessage(message, showOutput)
  ).then((a) => a === showOutput && kit.output.show(true));
}

async function openPreset(kit: Kit): Promise<void> {
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { [t('Profile Kit preset')]: ['json', 'jsonc'] },
    openLabel: t('Use as Preset'),
  });
  if (!picked?.[0]) return;
  await setPresetPath(picked[0].fsPath);
  await kit.loadPreset();
  await kit.refresh();
}

function setPresetPath(file: string): Thenable<void> {
  // application scope: one value for every profile
  return vscode.workspace.getConfiguration('profileKit').update('presetPath', file, vscode.ConfigurationTarget.Global);
}

/** Draft a preset from the extensions of this window's profile. */
async function createPreset(kit: Kit): Promise<void> {
  const own = kit.context.extension.id.toLowerCase();
  const builtinRoot = vscode.env.appRoot.toLowerCase();
  const ids = vscode.extensions.all
    .filter((e) => !e.extensionPath.toLowerCase().startsWith(builtinRoot) && e.id.toLowerCase() !== own)
    .map((e) => e.id.toLowerCase())
    .sort();
  const current = kit.currentProfile()?.name;
  const profile = current && current !== DEFAULT_PROFILE ? current : 'Core';
  const draft = { core: ids, groups: {}, settings: {}, profiles: { [profile]: {} } };
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const target = await vscode.window.showSaveDialog({
    ...(folder ? { defaultUri: vscode.Uri.file(path.join(folder, 'extensions.profile-kit.json')) } : {}),
    filters: { [t('Profile Kit preset')]: ['json'] },
    saveLabel: t('Create Preset'),
  });
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(`${JSON.stringify(draft, null, 2)}\n`));
  await setPresetPath(target.fsPath);
  await kit.loadPreset();
  await kit.refresh();
  await vscode.window.showTextDocument(target);
  void vscode.window.showInformationMessage(
    t('Preset created with the {0} extensions of this profile as core. Move per-purpose ones into groups.', ids.length),
  );
}

async function showPlan(kit: Kit): Promise<void> {
  const loaded = requirePreset(kit);
  if (!loaded) return;
  kit.output.clear();
  for (const name of profileNames(loaded.preset)) {
    const ids = resolveProfile(loaded.preset, name);
    kit.log(`== ${name} (${ids.length}) ==`);
    for (const id of ids) kit.log(`  ${id}`);
  }
  kit.output.show(true);
}

export function registerCommands(kit: Kit): vscode.Disposable[] {
  const reg = (id: string, fn: (...args: unknown[]) => unknown) =>
    vscode.commands.registerCommand(id, async (...args: unknown[]) => {
      try {
        await fn(...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        kit.log(`! ${id}: ${message}`);
        void vscode.window.showErrorMessage(t('Profile Kit: {0}', message));
      }
    });
  return [
    reg('profileKit.showPlan', () => showPlan(kit)),
    reg('profileKit.openPreset', () => openPreset(kit)),
    reg('profileKit.createPreset', () => createPreset(kit)),
    reg('profileKit.editPreset', async () => {
      const loaded = kit.preset;
      const file = kit.presetPath();
      if (!file) return vscode.commands.executeCommand('profileKit.openPreset');
      await vscode.window.showTextDocument(loaded?.uri ?? vscode.Uri.file(file));
    }),
    reg('profileKit.refresh', () =>
      vscode.window.withProgress({ location: { viewId: 'profileKit.profiles' } }, () =>
        kit.loadPreset().then(() => kit.refresh()),
      ),
    ),
    reg('profileKit.installMissing', (arg) => installMissing(kit, arg)),
    reg('profileKit.applyProfile', async (arg) => {
      const name = profileOf(arg) ?? (await pickDeclared(kit, t('Apply the preset to...')));
      if (name) await apply(kit, [name]);
    }),
    reg('profileKit.applyAll', () => apply(kit, kit.declaredNames())),
    reg('profileKit.switchProfile', () => switchProfile(kit)),
    reg('profileKit.switchTo', (arg) => switchProfile(kit, profileOf(arg))),
  ];
}
