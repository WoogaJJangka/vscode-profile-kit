/**
 * Manager panel (webview): extensions × profiles matrix and settings table, each with Preview → Apply.
 * The webview only collects wishes; every edit and install is computed and done here, again at apply time
 * (the preview's token makes sure the preset file did not change in between).
 */
import { createHash, randomBytes } from 'node:crypto';

import * as vscode from 'vscode';

import {
  addExtension,
  isAppliedToAllProfiles,
  membershipEdits,
  normalizeId,
  parsePresetText,
  type Preset,
  PresetError,
  profileNames,
  profilesWithExtension,
  removeExtension,
  setSetting,
} from '../../core';
import { buildPlans, executePlans, readDefaultSettings, reportOk } from '../../host/apply';
import { installExtensions, installSucceeded } from '../../host/installer';
import type { Kit } from '../kit';
import type {
  ExtensionChange,
  FromWebview,
  ManagerState,
  PanelExtension,
  Preview,
  PreviewLine,
  SettingChange,
  ToWebview,
} from './protocol';

const t = vscode.l10n.t;

/** English UI strings the webview uses; sent translated with each state. */
const WEBVIEW_STRINGS = [
  'Extensions',
  'Settings',
  'Filter extensions',
  'Show extensions not in the preset',
  'Add Extension...',
  'Edit Preset',
  'Refresh',
  'Preview',
  'Discard',
  'Apply',
  'Back',
  'change(s)',
  'Nothing to change.',
  'core',
  'group',
  'profile only',
  'not in the preset',
  'installed',
  'declared, not installed',
  'installed, not declared',
  'not created yet',
  'this window',
  'uses Default settings',
  'all profiles (from Default)',
  'Default applies this setting to all profiles (Apply Setting to all Profiles), so a profile cannot have its own value.',
  'Common (all profiles)',
  'Setting',
  'Add Setting',
  'setting.key',
  'JSON value, e.g. true, 4, "text"',
  'Not valid JSON',
  'empty = not set',
  'Checked = declared in the preset for that profile. Unchecking only removes it from the preset; nothing is uninstalled.',
  'Values are JSON. A profile value replaces the common one. Apply writes the preset, then each profile settings.json (backed up first).',
  'No preset file is set.',
] as const;

const fingerprint = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export class ManagerPanel implements vscode.Disposable {
  private static current: ManagerPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  static show(kit: Kit): void {
    kit.showAllProfiles();
    if (ManagerPanel.current) {
      ManagerPanel.current.panel.reveal();
      return;
    }
    ManagerPanel.current = new ManagerPanel(kit);
  }

  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly kit: Kit) {
    const media = vscode.Uri.joinPath(kit.context.extensionUri, 'media');
    const dist = vscode.Uri.joinPath(kit.context.extensionUri, 'dist');
    this.panel = vscode.window.createWebviewPanel('profileKit.manager', t('Profile Kit'), vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [media, dist],
    });
    this.panel.iconPath = vscode.Uri.joinPath(media, 'activitybar.svg');
    this.panel.webview.html = this.html(media, dist);
    this.disposables.push(
      this.panel.onDidDispose(() => this.dispose()),
      this.panel.webview.onDidReceiveMessage((m: FromWebview) => void this.onMessage(m)),
      kit.onDidChange(() => void this.post({ type: 'state', state: this.state() })),
    );
  }

  private html(media: vscode.Uri, dist: vscode.Uri): string {
    const webview = this.panel.webview;
    const nonce = randomBytes(18).toString('base64');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'manager.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js'));
    return `<!DOCTYPE html>
<html lang="${vscode.env.language}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css.toString()}">
<title>Profile Kit</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${js.toString()}"></script>
</body>
</html>`;
  }

  private post(message: ToWebview): Thenable<boolean> {
    return this.panel.webview.postMessage(message);
  }

  private state(): ManagerState {
    const loaded = this.kit.preset;
    const strings = Object.fromEntries(WEBVIEW_STRINGS.map((s) => [s, t(s)]));
    const current = this.kit.currentProfile()?.name;
    const rows = this.kit.rows();
    const preset = loaded?.preset;
    const declared = preset ? profileNames(preset) : [];
    const profiles = declared.map((name) => {
      const row = rows.find((r) => r.name === name);
      return {
        name,
        exists: !!row?.stored,
        current: name === current,
        sharesSettings:
          preset?.profiles[name].shareFromDefault?.settings === true || row?.stored?.useDefaultFlags.settings === true,
      };
    });
    const installedIn = (id: string) => rows.filter((r) => r.installed?.includes(id)).map((r) => r.name);
    const extensions: PanelExtension[] = [];
    const seen = new Set<string>();
    const push = (id: string, section: string) => {
      const key = normalizeId(id);
      if (seen.has(key)) return;
      seen.add(key);
      const pkg = vscode.extensions.getExtension(key)?.packageJSON as { displayName?: unknown } | undefined;
      const displayName =
        typeof pkg?.displayName === 'string' && !pkg.displayName.startsWith('%') ? pkg.displayName : undefined;
      extensions.push({
        id: key,
        ...(displayName ? { displayName } : {}),
        section,
        declaredIn: preset ? profilesWithExtension(preset, key) : [],
        installedIn: installedIn(key).filter((p) => declared.includes(p)),
      });
    };
    if (preset) {
      for (const id of preset.core) push(id, 'core');
      for (const [g, ids] of Object.entries(preset.groups)) for (const id of ids) push(id, `group ${g}`);
      for (const name of declared) for (const id of preset.profiles[name].extensions ?? []) push(id, 'profile');
      const own = this.kit.context.extension.id.toLowerCase();
      for (const row of rows)
        if (declared.includes(row.name)) for (const id of row.installed ?? []) if (id !== own) push(id, 'undeclared');
    }
    const listed = readDefaultSettings(this.kit.paths).state.allProfiles;
    return {
      presetPath: loaded?.uri.fsPath ?? this.kit.presetPath(),
      ...(this.kit.presetError ? { presetError: this.kit.presetError } : {}),
      profiles,
      extensions,
      settings: {
        common: preset?.settings ?? {},
        profiles: Object.fromEntries(declared.map((n) => [n, preset?.profiles[n].settings ?? {}])),
        allProfiles: listed.filter((k) => isAppliedToAllProfiles(k, listed)),
      },
      strings,
    };
  }

  private async onMessage(m: FromWebview): Promise<void> {
    try {
      switch (m.type) {
        case 'ready':
          await this.post({ type: 'state', state: this.state() });
          return;
        case 'refresh':
          await this.busy(t('Reading profiles...'), () => this.kit.loadPreset().then(() => this.kit.refresh()));
          return;
        case 'installToProfiles':
          await vscode.commands.executeCommand('profileKit.installToProfiles');
          return;
        case 'editPreset':
          await vscode.commands.executeCommand('profileKit.editPreset');
          return;
        case 'openExtension':
          await vscode.commands.executeCommand('extension.open', m.id);
          return;
        case 'previewExtensions':
          await this.post({ type: 'preview', kind: 'extensions', preview: this.previewExtensions(m.changes).preview });
          return;
        case 'applyExtensions':
          await this.applyExtensions(m.changes, m.token);
          return;
        case 'previewSettings': {
          const preview = await this.busy(t('Reading settings...'), () => this.previewSettings(m.changes));
          await this.post({ type: 'preview', kind: 'settings', preview: preview.preview });
          return;
        }
        case 'applySettings':
          await this.applySettings(m.changes, m.token);
          return;
      }
    } catch (error) {
      const message = error instanceof PresetError || error instanceof Error ? error.message : String(error);
      this.kit.log(`! manager: ${message}`);
      await this.post({ type: 'error', message });
    }
  }

  private async busy<T>(message: string, fn: () => Promise<T>): Promise<T> {
    await this.post({ type: 'busy', busy: true, message });
    try {
      return await fn();
    } finally {
      await this.post({ type: 'busy', busy: false });
    }
  }

  private requireText(): { text: string; preset: Preset; uri: vscode.Uri } {
    const loaded = this.kit.preset;
    if (!loaded) throw new Error(this.kit.presetError ?? t('No preset file is set.'));
    return loaded;
  }

  // ---- extensions --------------------------------------------------------------------------------------------

  private previewExtensions(changes: ExtensionChange[]): {
    preview: Preview;
    text: string;
    installs: Map<string, string[]>;
  } {
    const { text: original, preset } = this.requireText();
    let text = original;
    const lines: PreviewLine[] = [];
    const installs = new Map<string, string[]>();
    const rows = new Map(this.kit.rows().map((r) => [r.name, r]));
    const where = (x: { kind: string; name?: string }) =>
      x.kind === 'core'
        ? t('core')
        : x.kind === 'group'
          ? t('group "{0}"', x.name ?? '')
          : t('"{0}" extensions', x.name ?? '');

    for (const change of changes) {
      const id = normalizeId(change.id);
      const edits = membershipEdits(preset, id, change.profiles);
      for (const target of edits.remove) {
        text = removeExtension(text, target, id);
        lines.push({ kind: 'preset', text: t('remove {0} from {1}', id, where(target)) });
      }
      for (const target of edits.add) {
        text = addExtension(text, target, id);
        lines.push({ kind: 'preset', text: t('add {0} to {1}', id, where(target)) });
      }
      const before = new Set(profilesWithExtension(preset, id));
      for (const p of change.profiles) {
        const row = rows.get(p);
        if (!row?.stored) {
          if (!before.has(p))
            lines.push({ kind: 'note', text: t('{0}: profile not created yet; apply the preset later', p) });
        } else if (!(row.installed ?? []).includes(id)) installs.set(id, [...(installs.get(id) ?? []), p]);
      }
      for (const p of before)
        if (!change.profiles.includes(p) && rows.get(p)?.installed?.includes(id))
          lines.push({ kind: 'note', text: t('{0} stays installed in {1} (Profile Kit does not uninstall)', id, p) });
    }
    for (const [id, profiles] of installs)
      lines.push({ kind: 'install', text: t('install {0} in {1}', id, profiles.join(', ')) });
    parsePresetText(text); // throws if an edit broke the preset
    const empty = text === original && installs.size === 0;
    return { preview: { token: fingerprint(original), lines, empty }, text, installs };
  }

  private async applyExtensions(changes: ExtensionChange[], token: string): Promise<void> {
    const loaded = this.requireText();
    if (fingerprint(loaded.text) !== token)
      throw new Error(t('The preset file changed after the preview. Preview again.'));
    const { text, installs } = this.previewExtensions(changes);
    await this.writePreset(loaded.uri, loaded.text, text);
    const failed: string[] = [];
    if (installs.size)
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: t('Profile Kit'), cancellable: true },
        async (progress, cancel) => {
          for (const [id, profiles] of installs)
            for (const p of profiles) {
              if (cancel.isCancellationRequested) return;
              progress.report({ message: `${id} → ${p}` });
              this.kit.markInstalling(id);
              const [r] = await installExtensions(this.kit.run, p, [id]);
              this.kit.log(`  ${p}: ${id} ${r?.outcome ?? 'skipped'}${r?.detail ? ` ${r.detail}` : ''}`);
              if (!r || !installSucceeded(r.outcome)) failed.push(`${id} → ${p}`);
            }
        },
      );
    await this.kit.refresh();
    if (failed.length) await this.post({ type: 'error', message: t('Some installs failed: {0}', failed.join(', ')) });
    else await this.post({ type: 'done', message: t('Applied.') });
  }

  private async writePreset(uri: vscode.Uri, original: string, text: string): Promise<void> {
    if (text === original) return;
    const dirty = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === uri.fsPath && d.isDirty);
    if (dirty) throw new Error(t('Save or revert the preset file first; it has unsaved changes.'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
    this.kit.log(`preset written: ${uri.fsPath}`);
    await this.kit.loadPreset();
  }

  // ---- settings ----------------------------------------------------------------------------------------------

  private editSettings(original: string, changes: SettingChange[]): string {
    const bad: string[] = [];
    let text = original;
    for (const c of changes) {
      let value: unknown;
      if (c.value !== undefined) {
        try {
          value = JSON.parse(c.value);
        } catch {
          bad.push(`${c.scope || t('common')}: ${c.key}`);
          continue;
        }
      }
      text = setSetting(text, c.scope ? { kind: 'profile', name: c.scope } : { kind: 'common' }, c.key, value);
    }
    if (bad.length) throw new Error(t('Not valid JSON: {0}', bad.join(', ')));
    return text;
  }

  private async previewSettings(changes: SettingChange[]): Promise<{ preview: Preview; text: string; preset: Preset }> {
    const { text: original } = this.requireText();
    const text = this.editSettings(original, changes);
    const preset = parsePresetText(text);
    const lines: PreviewLine[] = changes.map((c) => ({
      kind: 'preset' as const,
      text:
        c.value === undefined
          ? t('{0}: remove {1}', c.scope || t('common'), c.key)
          : t('{0}: {1} = {2}', c.scope || t('common'), c.key, c.value),
    }));
    const existing = profileNames(preset).filter((n) => this.kit.profiles.some((p) => p.name === n));
    const { plans, problems } = await buildPlans({ run: this.kit.run, paths: this.kit.paths }, preset, existing);
    for (const p of problems) lines.push({ kind: 'note', text: p });
    for (const plan of plans) {
      for (const n of plan.notes) lines.push({ kind: 'note', text: `${plan.name}: ${n}` });
      for (const c of plan.settings?.changes ?? [])
        lines.push({
          kind: 'settings',
          text:
            c.kind === 'remove'
              ? t('{0} settings.json: remove {1}', plan.name, c.key)
              : t(
                  '{0} settings.json: {1} = {2}{3}',
                  plan.name,
                  c.key,
                  JSON.stringify(c.after),
                  c.overridesUser ? ` (${t('replaces your value')})` : '',
                ),
        });
    }
    for (const n of profileNames(preset).filter((x) => !existing.includes(x)))
      lines.push({
        kind: 'note',
        text: t('{0}: profile not created yet; its settings are written when the preset is applied', n),
      });
    const empty = text === original && !lines.some((l) => l.kind === 'settings');
    return { preview: { token: fingerprint(original), lines, empty }, text, preset };
  }

  private async applySettings(changes: SettingChange[], token: string): Promise<void> {
    const loaded = this.requireText();
    if (fingerprint(loaded.text) !== token)
      throw new Error(t('The preset file changed after the preview. Preview again.'));
    const text = this.editSettings(loaded.text, changes);
    const preset = parsePresetText(text);
    await this.writePreset(loaded.uri, loaded.text, text);
    const existing = profileNames(preset).filter((n) => this.kit.profiles.some((p) => p.name === n));
    const env = { run: this.kit.run, paths: this.kit.paths };
    const reports = await this.busy(t('Writing settings...'), async () => {
      const { plans } = await buildPlans(env, preset, existing);
      // settings only: no installs, no new profiles from this tab
      const settingsOnly = plans.map((p) => ({ ...p, create: false, extensions: { ...p.extensions, missing: [] } }));
      return executePlans(env, preset, settingsOnly, { createProfiles: false });
    });
    for (const r of reports)
      this.kit.log(
        `settings ${r.name}: ${r.settingsChanged} written${r.backup ? `, backup ${r.backup}` : ''}${r.problems.length ? `; ${r.problems.join('; ')}` : ''}`,
      );
    await this.kit.refresh();
    const bad = reports.filter((r) => !reportOk(r));
    if (bad.length)
      await this.post({
        type: 'error',
        message: t('Settings not written for: {0} (see Output)', bad.map((r) => r.name).join(', ')),
      });
    else await this.post({ type: 'done', message: t('Applied.') });
  }

  private disposed = false;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    ManagerPanel.current = undefined;
    for (const d of this.disposables) d.dispose();
    this.panel.dispose();
  }
}
