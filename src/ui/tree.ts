/**
 * Activity Bar > Profile Kit > Profiles: one row per profile (declared and/or existing) with ok / missing / extra
 * counts, and its extensions underneath. Item context values drive the inline buttons in package.json:
 *   profile:<exists|absent>:<declared|undeclared>[:missing]:<current|other>
 * Above them, one row with the next step (apply when something is missing; its tooltip names the preset file), and on
 * the Activity Bar icon a badge with the number of profiles that need changes.
 */
import * as vscode from 'vscode';

import { declaredCount, extensionOrigins, needsChanges } from '../core';
import { type Kit, type ProfileRow } from './kit';

type Node = ProfileNode | ExtensionNode | MessageNode;

export interface ProfileNode {
  kind: 'profile';
  row: ProfileRow;
}
interface ExtensionNode {
  kind: 'extension';
  profile: string;
  id: string;
  state: 'ok' | 'missing' | 'extra' | 'installed';
  origin?: string;
  /** VS Code applies it to all profiles ("Apply Extension to all Profiles"), so every profile lists it. */
  allProfiles?: boolean;
}
interface MessageNode {
  kind: 'message';
  label: string;
  description?: string;
  icon: string;
  /** Theme color ID for the icon. */
  color?: string;
  tooltip?: string;
  command?: vscode.Command;
}

const t = vscode.l10n.t;

export class ProfilesTree implements vscode.TreeDataProvider<Node> {
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly kit: Kit) {
    kit.onDidChange(() => this.changed.fire(undefined));
  }

  getChildren(node?: Node): Node[] {
    if (!node) return this.roots();
    if (node.kind !== 'profile') return [];
    return this.extensionsOf(node.row);
  }

  private roots(): Node[] {
    // no preset: an empty tree, so VS Code shows the welcome view with the ways to start (it only shows when the
    // tree has no items; before 1.1.0 existing profiles hid it). Switching still works from the status bar.
    if (!this.kit.presetPath()) return [];
    const out: Node[] = [];
    if (this.kit.presetMissing)
      out.push({
        kind: 'message',
        label: t('Preset file not found on this PC'),
        icon: 'warning',
        tooltip: this.kit.presetError ?? '',
        command: { command: 'profileKit.openPreset', title: t('Open Preset File...') },
      });
    else if (this.kit.presetError)
      out.push({
        kind: 'message',
        label: t('Preset has problems'),
        icon: 'error',
        tooltip: this.kit.presetError,
        command: { command: 'profileKit.editPreset', title: t('Edit Preset') },
      });
    if (!this.kit.codeCli)
      out.push({
        kind: 'message',
        label: t('code CLI not found next to VS Code; using "code" from PATH'),
        icon: 'warning',
      });
    for (const p of this.kit.storageInfo.problems) out.push({ kind: 'message', label: p, icon: 'warning' });
    const next = this.nextStep();
    if (next) out.push(next);
    out.push(...this.kit.rows().map((row): ProfileNode => ({ kind: 'profile', row })));
    return out;
  }

  /** The top row: what applying the preset would do, as far as is known, and a click to do it. */
  private nextStep(): MessageNode | undefined {
    const loaded = this.kit.preset;
    if (!loaded) return undefined;
    const status = this.kit.status();
    const total = declaredCount(status);
    if (!total) return undefined;
    const apply = { command: 'profileKit.applyAll', title: t('Apply Preset to All Profiles...') };
    // the view's own description would not show: a view alone in its container has its header merged into the
    // container title, which drops the description (seen in VS Code 1.147)
    const presetLine = t('Preset: {0}', loaded.uri.fsPath);
    const todo = needsChanges(status);
    if (todo.length)
      return {
        kind: 'message',
        label: t('{0} profile(s) need changes', todo.length),
        description: t('click to preview and apply'),
        icon: 'arrow-circle-right',
        color: 'list.warningForeground',
        tooltip: [
          status.notCreated.length ? t('Not created yet: {0}', status.notCreated.join(', ')) : '',
          status.missing.length ? t('Missing extensions: {0}', status.missing.join(', ')) : '',
          t('Applying shows every change first and asks before doing anything.'),
          presetLine,
        ]
          .filter(Boolean)
          .join('\n'),
        command: apply,
      };
    if (status.checking.length)
      return { kind: 'message', label: t('Checking {0} profile(s)...', status.checking.length), icon: 'loading~spin' };
    return {
      kind: 'message',
      label: t('All {0} profile(s) have their extensions', total),
      description: t('click to check settings too'),
      icon: 'pass',
      color: 'testing.iconPassed',
      tooltip: [
        t('Applying also writes the preset settings; it shows the changes first, or says everything is up to date.'),
        presetLine,
      ].join('\n'),
      command: apply,
    };
  }

  private extensionsOf(row: ProfileRow): ExtensionNode[] {
    const preset = this.kit.preset?.preset;
    const origins = preset && row.declared ? extensionOrigins(preset, row.name) : new Map<string, string>();
    if (row.diff) {
      const node = (id: string, state: ExtensionNode['state']): ExtensionNode => ({
        kind: 'extension',
        profile: row.name,
        id,
        state,
        ...(origins.get(id) ? { origin: origins.get(id) } : {}),
        ...(this.kit.appliedToAll(id) ? { allProfiles: true } : {}),
      });
      return [
        ...row.diff.missing.map((id) => node(id, 'missing')),
        ...row.diff.present.map((id) => node(id, 'ok')),
        ...row.diff.extra.map((id) => node(id, 'extra')),
      ];
    }
    if (!row.stored && preset && row.declared)
      return [...origins.keys()].map((id) => ({
        kind: 'extension',
        profile: row.name,
        id,
        state: 'missing',
        ...(origins.get(id) ? { origin: origins.get(id) } : {}),
      }));
    return (row.installed ?? []).map((id) => ({
      kind: 'extension',
      profile: row.name,
      id,
      state: 'installed',
      ...(this.kit.appliedToAll(id) ? { allProfiles: true } : {}),
    }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(node.icon, node.color ? new vscode.ThemeColor(node.color) : undefined);
      if (node.description) item.description = node.description;
      if (node.tooltip) item.tooltip = node.tooltip;
      if (node.command) item.command = node.command;
      return item;
    }
    if (node.kind === 'extension') return this.extensionItem(node);
    return this.profileItem(node.row);
  }

  private profileItem(row: ProfileRow): vscode.TreeItem {
    const current = this.kit.currentProfile()?.name === row.name;
    const item = new vscode.TreeItem(row.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `profile:${row.name}`;
    const missing = row.diff ? row.diff.missing.length : row.declared && !row.stored ? 1 : 0;
    item.contextValue = [
      'profile',
      row.stored ? 'exists' : 'absent',
      row.declared ? 'declared' : 'undeclared',
      ...(missing ? ['missing'] : []),
      current ? 'current' : 'other',
    ].join(':');

    let description: string;
    let icon: vscode.ThemeIcon;
    if (!row.declared) {
      description = t('not in the preset');
      icon = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
    } else if (!row.stored) {
      description = t('not created yet');
      icon = new vscode.ThemeIcon('circle-large-outline', new vscode.ThemeColor('list.warningForeground'));
    } else if (!row.diff) {
      description = t('checking...');
      icon = new vscode.ThemeIcon('loading~spin');
    } else {
      const { present, missing: miss, extra } = row.diff;
      description = miss.length
        ? t('{0} ok · {1} missing · {2} extra', present.length, miss.length, extra.length)
        : t('{0} ok · {1} extra', present.length, extra.length);
      icon = miss.length
        ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'))
        : new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    }
    item.description = current ? `${description} · ${t('this window')}` : description;
    item.iconPath = current ? new vscode.ThemeIcon('account', icon.color) : icon;

    const md = new vscode.MarkdownString(undefined, true);
    md.appendMarkdown(`**${row.name}**${current ? ` — ${t('this window')}` : ''}\n\n`);
    if (row.stored?.useDefaultFlags.settings) md.appendMarkdown(`- ${t('uses Default settings')}\n`);
    if (row.stored?.useDefaultFlags.extensions) md.appendMarkdown(`- ${t('uses Default extensions')}\n`);
    if (row.diff?.missing.length)
      md.appendMarkdown(`- $(cloud-download) ${t('Install missing: inline button or right-click')}\n`);
    item.tooltip = md;
    return item;
  }

  private extensionItem(node: ExtensionNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.id, vscode.TreeItemCollapsibleState.None);
    item.id = `ext:${node.profile}:${node.id}`;
    item.contextValue = `extension:${node.state}`;
    const label: Record<ExtensionNode['state'], string> = {
      ok: t('installed'),
      missing: t('missing'),
      extra: t('installed, not in the preset'),
      installed: t('installed'),
    };
    // an "extra" that VS Code applies to all profiles is not something the user added to this profile
    const scopedExtra = node.allProfiles === true && node.state === 'extra';
    item.description = [
      node.origin,
      node.state === 'ok' || node.state === 'installed' || scopedExtra ? '' : label[node.state],
      node.allProfiles ? t('all profiles (VS Code)') : '',
    ]
      .filter(Boolean)
      .join(' · ');
    item.tooltip = [
      node.id,
      label[node.state],
      node.origin ? `${t('from')}: ${node.origin}` : '',
      node.allProfiles ? t('VS Code applies this extension to all profiles (Apply Extension to all Profiles).') : '',
      node.allProfiles && node.origin === 'core' ? t('It is also in core; either one is enough.') : '',
    ]
      .filter(Boolean)
      .join('\n');
    const icons: Record<ExtensionNode['state'], vscode.ThemeIcon> = {
      ok: new vscode.ThemeIcon('check'),
      installed: new vscode.ThemeIcon('extensions'),
      missing: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('list.warningForeground')),
      extra: new vscode.ThemeIcon('dash', new vscode.ThemeColor('disabledForeground')),
    };
    item.iconPath = scopedExtra ? new vscode.ThemeIcon('globe') : icons[node.state];
    item.command = { command: 'extension.open', title: t('Show Extension'), arguments: [node.id] };
    return item;
  }
}

/** The Activity Bar badge: the number of profiles that need changes. */
export function decorateView<T>(view: vscode.TreeView<T>, kit: Kit): vscode.Disposable {
  const update = () => {
    // only what is known: profiles not listed yet (the view was never shown in this window) do not count
    const todo = kit.preset ? needsChanges(kit.status()).length : 0;
    view.badge = todo ? { value: todo, tooltip: t('{0} profile(s) need changes', todo) } : undefined;
  };
  update();
  return kit.onDidChange(update);
}
