/**
 * Profile Kit extension: the GUI (docs/PLAN.md section 8, structure decided 2026-11-21).
 * Activity Bar tree of profiles, status bar with this window's profile, commands to install, apply and switch.
 * Work that touches other profiles goes through src/host (the `code` CLI, settings.json files), shared with the CLI.
 */
import * as vscode from 'vscode';

import { registerCommands } from './ui/commands';
import { InstallWatcher } from './ui/installFlow';
import { Kit } from './ui/kit';
import { ProfileStatusBar } from './ui/switch';
import { ProfilesTree } from './ui/tree';

export function activate(context: vscode.ExtensionContext): void {
  const kit = new Kit(context);
  const tree = new ProfilesTree(kit);
  const view = vscode.window.createTreeView('profileKit.profiles', { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(
    kit,
    view,
    new ProfileStatusBar(kit),
    new InstallWatcher(kit),
    ...registerCommands(kit),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('profileKit.presetPath')) void kit.loadPreset().then(() => kit.refresh());
      // the marker changes when Profile Kit writes this profile's settings
      else if (e.affectsConfiguration('profileKit.profile')) void kit.refresh();
    }),
    // installs and uninstalls in this window's profile (other profiles do not fire this, PLAN.md section 8, #6)
    vscode.extensions.onDidChange(() => {
      const current = kit.currentProfile()?.name;
      if (current) void kit.refreshProfile(current);
    }),
  );
  void kit.loadPreset().then(() => kit.refresh());
}

export function deactivate(): void {
  // everything is in context.subscriptions
}
