/**
 * Moving the preset between a file on this PC and Settings (`profileKit.preset`), where Settings Sync takes it to the
 * other PCs (docs/PLAN.md section 12). Neither direction deletes the file.
 */
import * as vscode from 'vscode';

import { parsePresetText, syncedPresetValue } from '../core';
import type { Kit } from './kit';
import { askNewPresetFile } from './presetFile';
import { readSyncedPreset, SYNCED_PRESET_URI, writeSyncedPreset } from './syncedPreset';

const t = vscode.l10n.t;

function unsaved(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((d) => d.uri.toString() === uri.toString() && d.isDirty);
}

/** The preset file in use → `profileKit.preset`. The file stays as it is but is no longer read. */
export async function storePresetInSettings(kit: Kit): Promise<void> {
  const source = kit.presetSource();
  if (source?.kind === 'settings') {
    void vscode.window.showInformationMessage(t('The preset is already stored in Settings.'));
    return;
  }
  const loaded = kit.preset;
  if (!source || !loaded) {
    void vscode.window.showWarningMessage(
      kit.presetError ? t('Fix the preset first: {0}', kit.presetError) : t('Open or create a preset first.'),
    );
    return;
  }
  if (unsaved(loaded.uri)) throw new Error(t('Save or revert the preset file first; it has unsaved changes.'));
  parsePresetText(loaded.text); // only a preset that loads
  const store = t('Store in Settings');
  const answer = await vscode.window.showInformationMessage(
    t('Store the preset in Settings, so Settings Sync takes it to your other PCs?'),
    {
      modal: true,
      detail: t(
        'Profile Kit then reads the preset from the setting profileKit.preset (Default profile) on every PC that syncs settings. {0} is not changed or deleted, but no longer used. Comments in the file are not kept.',
        source.file,
      ),
    },
    store,
  );
  if (answer !== store) return;
  await writeSyncedPreset(syncedPresetValue(loaded.text));
  await kit.loadPreset();
  await kit.refresh();
  kit.log(`preset stored in Settings (profileKit.preset), from ${source.file}`);
  const edit = t('Edit Preset');
  const pick = await vscode.window.showInformationMessage(
    t('The preset is stored in Settings. Turn on Settings in Settings Sync so it reaches your other PCs.'),
    edit,
  );
  if (pick === edit) await vscode.window.showTextDocument(SYNCED_PRESET_URI);
}

/** `profileKit.preset` → a new file on this PC, used from then on. Settings Sync then removes it on the other PCs. */
export async function movePresetToFile(kit: Kit): Promise<void> {
  const synced = readSyncedPreset();
  if (!synced) {
    void vscode.window.showInformationMessage(t('No preset is stored in Settings.'));
    return;
  }
  if (unsaved(SYNCED_PRESET_URI)) throw new Error(t('Save or revert the preset file first; it has unsaved changes.'));
  const target = await askNewPresetFile();
  if (!target) return;
  const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(SYNCED_PRESET_URI));
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
  if (!(await kit.usePreset(target.fsPath))) return;
  await vscode.window.showTextDocument(target);
}
