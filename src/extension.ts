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
import { SYNCED_PRESET_SCHEME, SyncedPresetFileSystem } from './ui/syncedPreset';
import { ProfileStatusBar } from './ui/switch';
import { decorateView, ProfilesTree } from './ui/tree';

/**
 * What the integration checks read (scripts/integration/suite.ts). Only handed out when VS Code runs extension tests
 * (`--extensionTestsPath`); a normal window exports nothing.
 */
export interface TestApi {
  kit: Kit;
  tree: ProfilesTree;
}

export function activate(context: vscode.ExtensionContext): TestApi | undefined {
  // the synced preset (profileKit.preset) as a file, before anything reads the preset
  const syncedPreset = new SyncedPresetFileSystem();
  context.subscriptions.push(
    syncedPreset,
    vscode.workspace.registerFileSystemProvider(SYNCED_PRESET_SCHEME, syncedPreset, { isCaseSensitive: true }),
  );
  const kit = new Kit(context);
  const tree = new ProfilesTree(kit);
  const folders = new FolderAdvisor(kit);
  // the welcome view's starter recommendation while there is no preset (it follows kit.onDidChange)
  const starters = new StarterAdvisor(kit);
  const view = vscode.window.createTreeView('profileKit.profiles', { treeDataProvider: tree, showCollapseAll: true });
  context.subscriptions.push(
    kit,
    decorateView(view, kit),
    view,
    new ProfileStatusBar(kit),
    new InstallWatcher(kit),
    folders,
    starters,
    ...registerCommands(kit),
    vscode.workspace.onDidChangeConfiguration((e) => {
      // profileKit.preset also changes when Settings Sync brings it from another PC
      if (e.affectsConfiguration('profileKit.presetPath') || e.affectsConfiguration('profileKit.preset'))
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
  return context.extensionMode === vscode.ExtensionMode.Test ? { kit, tree } : undefined;
}

export function deactivate(): void {
  // everything is in context.subscriptions
}
