/**
 * Status bar item with this window's profile, and switching profiles.
 * Switching uses VS Code's own per-profile command when it exists (PLAN.md section 8, #4):
 *   workbench.profiles.actions.profileEntry.<location>   switches this window in place
 * It is not a documented ID, so it is looked up first; the fallbacks are VS Code's own profile picker and
 * opening the folder in a new window with `code --profile`.
 */
import * as vscode from 'vscode';

import { DEFAULT_PROFILE_ID, profileEntryCommand, SWITCH_PROFILE_COMMAND } from '../core';
import { DEFAULT_PROFILE, type Kit } from './kit';

const t = vscode.l10n.t;

export class ProfileStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('profileKit.profile', vscode.StatusBarAlignment.Left, 100);

  constructor(private readonly kit: Kit) {
    this.item.name = t('Profile Kit: Profile');
    this.item.command = 'profileKit.switchProfile';
    kit.onDidChange(() => this.update());
    this.update();
    this.item.show();
  }

  update(): void {
    const current = this.kit.currentProfile();
    const row = current && this.kit.rows().find((r) => r.name === current.name);
    const missing = row?.diff?.missing.length ?? 0;
    const suggested = this.kit.folderSuggestion;
    const other = suggested && suggested.profile !== current?.name ? suggested : undefined;
    this.item.text = `$(layers) ${current?.name ?? t('Profile ?')}${missing ? ` $(warning) ${missing}` : ''}${other ? ' $(lightbulb)' : ''}`;
    const md = new vscode.MarkdownString(undefined, true);
    if (other)
      md.appendMarkdown(
        `$(lightbulb) ${t('This folder suggests the profile **{0}** ({1}).', other.profile, other.matched.join(', '))}\n\n`,
      );
    if (current) {
      md.appendMarkdown(`${t('This window uses the profile **{0}**.', current.name)}\n\n`);
      if (current.how === 'folder')
        md.appendMarkdown(`${t('(Known from the folder link; apply the preset to this profile to be sure.)')}\n\n`);
      if (missing) md.appendMarkdown(`$(warning) ${t('{0} declared extension(s) are not installed.', missing)}\n\n`);
    } else {
      md.appendMarkdown(
        `${t('Profile Kit cannot tell this profile yet: it learns it from the settings it writes. Apply the preset to this profile once.')}\n\n`,
      );
    }
    md.appendMarkdown(t('Click to switch profiles.'));
    this.item.tooltip = md;
  }

  dispose(): void {
    this.item.dispose();
  }
}

interface ProfilePick extends vscode.QuickPickItem {
  name: string;
  location: string;
}

/** Quick pick of profiles, then switch this window. */
export async function switchProfile(kit: Kit, target?: string): Promise<void> {
  const current = kit.currentProfile()?.name;
  let name = target;
  let location: string | undefined;
  if (!name) {
    const rows = new Map(kit.rows().map((r) => [r.name, r]));
    const suggested = kit.folderSuggestion;
    const profiles = [...kit.profiles].sort(
      (a, b) => Number(b.name === suggested?.profile) - Number(a.name === suggested?.profile),
    );
    const items: ProfilePick[] = [
      ...profiles.map((p) => {
        const row = rows.get(p.name);
        const missing = row?.diff?.missing.length ?? 0;
        const isSuggested = p.name === suggested?.profile;
        return {
          name: p.name,
          location: p.location,
          label: `${p.name === current ? '$(account)' : isSuggested ? '$(lightbulb)' : '$(layers)'} ${p.name}`,
          description: [
            p.name === current ? t('this window') : '',
            isSuggested ? t('suggested for this folder ({0})', suggested.matched.join(', ')) : '',
            row?.declared ? '' : t('not in the preset'),
            missing ? t('{0} missing', missing) : '',
          ]
            .filter(Boolean)
            .join(' · '),
        };
      }),
      { name: DEFAULT_PROFILE, location: DEFAULT_PROFILE_ID, label: `$(home) ${DEFAULT_PROFILE}`, description: '' },
    ];
    const picked = await vscode.window.showQuickPick(items, {
      title: t('Switch Profile'),
      placeHolder: t('Profile for this window'),
    });
    if (!picked) return;
    name = picked.name;
    location = picked.location;
  }
  if (name === current) return;
  location ??= name === DEFAULT_PROFILE ? DEFAULT_PROFILE_ID : kit.profiles.find((p) => p.name === name)?.location;
  if (!location) {
    void vscode.window.showWarningMessage(t('Profile "{0}" does not exist yet. Apply the preset to create it.', name));
    return;
  }

  const commands = await vscode.commands.getCommands(true);
  const direct = profileEntryCommand(location);
  if (commands.includes(direct)) {
    kit.log(`switch: ${direct}`);
    await vscode.commands.executeCommand(direct);
    return;
  }
  // fallback 1: VS Code's own picker (the user picks again, but it is the supported way)
  if (commands.includes(SWITCH_PROFILE_COMMAND)) {
    kit.log('switch: per-profile command not found, opening VS Code profile picker');
    await vscode.commands.executeCommand(SWITCH_PROFILE_COMMAND);
    return;
  }
  // fallback 2: this folder in a new window with that profile (VS Code then links the folder to it)
  if (kit.windowsBlocked) {
    void vscode.window.showWarningMessage(kit.windowsBlocked);
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  kit.log(`switch: opening ${folder ?? 'a new window'} with --profile ${name}`);
  await kit.run(['--profile', name, ...(folder ? [folder] : ['--new-window'])]);
}
