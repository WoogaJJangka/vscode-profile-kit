/**
 * Suggest a profile for the open folder from the names at its top level and the preset's `match.files`
 * (core/workspace.ts). Asks at most once per folder; switching uses the same path as the status bar
 * (VS Code then links the folder to that profile, so it opens there next time).
 */
import * as vscode from 'vscode';

import { folderKey, recommendForFolder } from '../core';
import type { Kit } from './kit';
import { switchProfile } from './switch';

const t = vscode.l10n.t;
const ASKED_KEY = 'profileKit.folderPrompts';

export interface FolderSuggestion {
  folder: string;
  profile: string;
  matched: string[];
}

export class FolderAdvisor implements vscode.Disposable {
  /** Folders answered "Not now" in this window (asked again in a new window). */
  private readonly snoozed = new Set<string>();
  private readonly subscriptions: vscode.Disposable[] = [];

  constructor(private readonly kit: Kit) {
    this.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => void this.check()));
  }

  /** Recompute the suggestion and, if this window is in another profile, ask (once per folder). */
  async check(): Promise<void> {
    const s = await this.compute();
    this.kit.setFolderSuggestion(s);
    if (!s) return;
    const current = this.kit.currentProfile()?.name;
    if (current === s.profile) return;
    const key = folderKey(s.folder);
    const asked = this.kit.context.globalState.get<Record<string, string>>(ASKED_KEY, {});
    if (asked[key] || this.snoozed.has(key)) return;
    await this.ask(s, key, asked);
  }

  private async compute(): Promise<FolderSuggestion | undefined> {
    const preset = this.kit.preset?.preset;
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!preset || !folder || folder.scheme !== 'file') return undefined;
    let names: string[];
    try {
      names = (await vscode.workspace.fs.readDirectory(folder)).map(([name]) => name);
    } catch {
      return undefined;
    }
    const [best, second] = recommendForFolder(preset, names);
    if (!best) return undefined;
    // a tie that includes this window's profile is not worth a prompt
    const current = this.kit.currentProfile()?.name;
    if (second && second.score === best.score && second.profile === current) return undefined;
    return { folder: folder.fsPath, profile: best.profile, matched: best.matched };
  }

  private async ask(s: FolderSuggestion, key: string, asked: Record<string, string>): Promise<void> {
    const exists = this.kit.profiles.some((p) => p.name === s.profile);
    const why = s.matched.slice(0, 3).join(', ');
    const message = exists
      ? t('This folder looks like a {0} project ({1}). Switch this window to the {0} profile?', s.profile, why)
      : t('This folder looks like a {0} project ({1}), but that profile does not exist yet.', s.profile, why);
    const go = exists ? t('Switch to {0}', s.profile) : t('Apply Preset to {0}...', s.profile);
    const later = t('Not Now');
    const never = t("Don't Ask for This Folder");
    const answer = await vscode.window.showInformationMessage(message, go, later, never);
    if (answer === go) {
      // remember it was answered, so the new window does not ask again if the switch is undone by hand
      await this.kit.context.globalState.update(ASKED_KEY, { ...asked, [key]: 'switched' });
      if (exists) await switchProfile(this.kit, s.profile);
      else await vscode.commands.executeCommand('profileKit.applyProfile', s.profile);
    } else if (answer === never) {
      await this.kit.context.globalState.update(ASKED_KEY, { ...asked, [key]: 'never' });
    } else {
      this.snoozed.add(key);
    }
  }

  dispose(): void {
    for (const d of this.subscriptions) d.dispose();
  }
}
