/**
 * Where a new preset file goes: a save dialog that starts in the open folder, or in the home folder when no folder
 * is open (instead of whatever place the dialog used last). Used by every command that creates a preset.
 */
import * as os from 'node:os';
import * as path from 'node:path';

import * as vscode from 'vscode';

const t = vscode.l10n.t;
export const NEW_PRESET_NAME = 'extensions.profile-kit.json';

export function newPresetUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.find((f) => f.uri.scheme === 'file')?.uri.fsPath ?? os.homedir();
  return vscode.Uri.file(path.join(folder, NEW_PRESET_NAME));
}

export function askNewPresetFile(): Thenable<vscode.Uri | undefined> {
  return vscode.window.showSaveDialog({
    defaultUri: newPresetUri(),
    filters: { [t('Profile Kit preset')]: ['json'] },
    saveLabel: t('Create Preset'),
  });
}
