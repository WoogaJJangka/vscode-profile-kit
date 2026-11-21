/**
 * Profile Kit extension: the GUI (docs/PLAN.md section 8, structure decided 2026-11-21).
 * Activity Bar tree of profiles, status bar with this window's profile, commands to install, apply and switch.
 * Work that touches other profiles goes through src/host (the `code` CLI, settings.json files), shared with the CLI.
 */
import * as vscode from 'vscode';

import { APPLY_TO_ALL_PROFILES_KEY } from './core/settings';
import { registerCommands } from './ui/commands';
import { FolderAdvisor } from './ui/folders';
import { InstallWatcher } from './ui/installFlow';
import { Kit } from './ui/kit';
import { StarterAdvisor } from './ui/starters';
import { ProfileStatusBar } from './ui/switch';
import { ProfilesTree } from './ui/tree';

export function activate(context: vscode.ExtensionContext): void {
  const kit = new Kit(context);
  const tree = new ProfilesTree(kit);
  const folders = new FolderAdvisor(kit);
  // the welcome view's starter recommendation while there is no preset (it follows kit.onDidChange)
  const starters = new StarterAdvisor(kit);
  const view = vscode.window.createTreeView('profileKit.profiles', { treeDataProvider: tree, showCollapseAll: true });
  // the tree shows every profile: list them all only once it is seen (review P5)
  if (view.visible) kit.showAllProfiles();
  context.subscriptions.push(
    kit,
    view,
    view.onDidChangeVisibility((e) => {
      if (e.visible) kit.showAllProfiles();
    }),
    new ProfileStatusBar(kit),
    new InstallWatcher(kit),
    folders,
    starters,
    ...registerCommands(kit),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('profileKit.presetPath'))
        void kit
          .loadPreset()
          .then(() => kit.refresh())
          .then(() => folders.check());
      // the marker changes when Profile Kit writes this profile's settings
      else if (e.affectsConfiguration('profileKit.profile')) void kit.refresh();
      // open windows only pick up a changed list after a reload (docs/PLAN.md section 8-1, #9-5)
      if (e.affectsConfiguration(APPLY_TO_ALL_PROFILES_KEY)) {
        void kit.refresh();
        const reload = vscode.l10n.t('Reload Window');
        void vscode.window
          .showInformationMessage(
            vscode.l10n.t(
              'The settings applied to all profiles changed. Reload open windows so each profile uses the new list.',
            ),
            reload,
          )
          .then((pick) => {
            if (pick === reload) void vscode.commands.executeCommand('workbench.action.reloadWindow');
          });
      }
    }),
    // installs and uninstalls in this window's profile (other profiles do not fire this, PLAN.md section 8, #6)
    vscode.extensions.onDidChange(() => {
      const current = kit.currentProfile()?.name;
      if (current) void kit.refreshProfile(current);
    }),
  );
  // folder suggestion after the profile list is known (it needs storage.json for "does it exist")
  void kit
    .loadPreset()
    .then(() => kit.refresh())
    .then(() => folders.check());
}

export function deactivate(): void {
  // everything is in context.subscriptions
}
