/**
 * Activity Bar > Profile Kit > Profiles: one row per profile (declared and/or existing) with ok / missing / extra
 * counts, and its extensions underneath. Item context values drive the inline buttons in package.json:
 *   profile:<exists|absent>:<declared|undeclared>[:missing]:<current|other>
 */
import * as vscode from 'vscode';

import { extensionOrigins } from '../core';
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
}
interface MessageNode {
  kind: 'message';
  label: string;
  icon: string;
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
    const out: Node[] = [];
    if (this.kit.presetError)
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
    out.push(...this.kit.rows().map((row): ProfileNode => ({ kind: 'profile', row })));
    return out;
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
    return (row.installed ?? []).map((id) => ({ kind: 'extension', profile: row.name, id, state: 'installed' }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'message') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(node.icon);
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
    item.description = [node.origin, node.state === 'ok' || node.state === 'installed' ? '' : label[node.state]]
      .filter(Boolean)
      .join(' · ');
    item.tooltip = `${node.id}\n${label[node.state]}${node.origin ? `\n${t('from')}: ${node.origin}` : ''}`;
    const icons: Record<ExtensionNode['state'], vscode.ThemeIcon> = {
      ok: new vscode.ThemeIcon('check'),
      installed: new vscode.ThemeIcon('extensions'),
      missing: new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('list.warningForeground')),
      extra: new vscode.ThemeIcon('dash', new vscode.ThemeColor('disabledForeground')),
    };
    item.iconPath = icons[node.state];
    item.command = { command: 'extension.open', title: t('Show Extension'), arguments: [node.id] };
    return item;
  }
}
