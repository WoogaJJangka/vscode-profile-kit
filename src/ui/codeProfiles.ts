/**
 * VS Code's own profile features, called instead of rebuilt (review stage C, docs/PLAN.md section 8-2):
 *   Export: preset profiles → `.code-profile` files, imported in VS Code's Profiles editor (the user confirms there).
 *   Import: `.code-profile` files or VS Code's built-in templates → profiles in the preset.
 * VS Code has no public command that imports a profile file, so Profile Kit only writes the files and opens the editor.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import * as vscode from 'vscode';

import {
  addImportedProfiles,
  CODE_PROFILE_EXTENSION,
  type ImportedProfile,
  parseCodeProfile,
  parsePresetText,
  presetFromImported,
  PROFILES_EDITOR_COMMAND,
} from '../core';
import { exportCodeProfiles, fetchTemplates, readTemplatesUrl } from '../host/builtins';
import type { Kit } from './kit';
import { askNewPresetFile } from './presetFile';
import type { ProfileNode } from './tree';

const t = vscode.l10n.t;

function profileArg(arg: unknown): string | undefined {
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object' && (arg as ProfileNode).kind === 'profile') return (arg as ProfileNode).row.name;
  return undefined;
}

/** Open VS Code's Profiles editor, where a `.code-profile` is imported. False when this VS Code has no such command. */
async function openProfilesEditor(): Promise<boolean> {
  if (!(await vscode.commands.getCommands(true)).includes(PROFILES_EDITOR_COMMAND)) {
    void vscode.window.showWarningMessage(
      t('This VS Code has no Profiles editor command. Open it from the gear menu > Profiles.'),
    );
    return false;
  }
  await vscode.commands.executeCommand(PROFILES_EDITOR_COMMAND);
  return true;
}

/** Write declared profiles as `.code-profile` files, then offer VS Code's Profiles editor to import them. */
export async function exportProfiles(kit: Kit, arg: unknown): Promise<void> {
  const loaded = kit.preset;
  if (!loaded) {
    void vscode.window.showWarningMessage(kit.presetError ?? t('No preset file is set.'));
    return;
  }
  const one = profileArg(arg);
  const names = one
    ? [one]
    : (
        await vscode.window.showQuickPick(
          kit.declaredNames().map((label) => ({ label, picked: true })),
          { title: t('Export as .code-profile'), canPickMany: true },
        )
      )?.map((p) => p.label);
  if (!names?.length) return;
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    ...(folder ? { defaultUri: folder } : {}),
    openLabel: t('Export Here'),
  });
  const dir = picked?.[0]?.fsPath;
  if (!dir) return;
  const result = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: t('Profile Kit: writing .code-profile files...') },
    () => exportCodeProfiles(loaded.preset, names, dir),
  );
  for (const f of result.files) kit.log(`wrote ${f}`);
  const open = t('Open Profiles Editor');
  const reveal = t('Show Folder');
  const answer = await vscode.window.showInformationMessage(
    t('{0} .code-profile file(s) written to {1}.', result.files.length, dir),
    {
      modal: true,
      detail: [
        t('In the Profiles editor, drop a file on it or use New Profile > Import Profile, then check and create it.'),
        t(
          'Import each file as a new profile: importing into an existing profile uninstalls the extensions the file does not list.',
        ),
        result.withoutUuids
          ? t('The Marketplace did not answer, so the files have extension IDs only; VS Code matches extensions by ID.')
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    open,
    reveal,
  );
  if (answer === open) await openProfilesEditor();
  else if (answer === reveal) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(result.files[0]));
}

/**
 * Let the user pick VS Code's built-in profile templates (the list VS Code itself shows under New Profile).
 * Returns [] when there is no list (no network, a build without templates) or nothing is picked.
 */
export async function pickTemplates(kit: Kit, title: string): Promise<ImportedProfile[]> {
  const url = readTemplatesUrl(vscode.env.appRoot);
  if (!url) return [];
  let templates;
  try {
    templates = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: t('Profile Kit: reading VS Code profile templates...') },
      () => fetchTemplates(url),
    );
  } catch (error) {
    kit.log(`! profile templates: ${String(error)}`);
    void vscode.window.showWarningMessage(t('VS Code profile templates could not be read (offline?).'));
    return [];
  }
  for (const { name, url: from, failure } of templates)
    if (failure)
      kit.log(
        `! template ${name} (${from}) ${failure.stage === 'download' ? 'not downloaded' : 'not read'}: ${failure.reason}`,
      );
  const items = templates.flatMap((x) =>
    x.profile
      ? [
          {
            label: x.name,
            description: t(
              '{0} extension(s), {1} setting(s)',
              x.profile.extensions.length,
              Object.keys(x.profile.settings ?? {}).length,
            ),
            detail: x.profile.extensions.join(', '),
            profile: x.profile,
          },
        ]
      : [],
  );
  if (!items.length) return [];
  const picked = await vscode.window.showQuickPick(items, { title, canPickMany: true, matchOnDetail: true });
  return picked?.map((p) => p.profile) ?? [];
}

async function readProfileFiles(kit: Kit): Promise<ImportedProfile[]> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: { [t('VS Code profile')]: [CODE_PROFILE_EXTENSION] },
    openLabel: t('Import'),
  });
  const out: ImportedProfile[] = [];
  const bad: string[] = [];
  for (const f of files ?? []) {
    try {
      out.push(parseCodeProfile(readFileSync(f.fsPath, 'utf8')));
    } catch (error) {
      bad.push(`${path.basename(f.fsPath)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const b of bad) kit.log(`! ${b}`);
  if (bad.length) void vscode.window.showWarningMessage(t('Not a VS Code profile file: {0}', bad.join('; ')));
  return out;
}

/** `.code-profile` files or VS Code templates → profiles in the current preset, or a new preset. */
export async function importProfiles(kit: Kit): Promise<void> {
  const fromFiles = { label: `$(file) ${t('.code-profile files...')}`, files: true };
  const fromTemplates = { label: `$(library) ${t('VS Code profile templates...')}`, files: false };
  const source = readTemplatesUrl(vscode.env.appRoot)
    ? await vscode.window.showQuickPick([fromFiles, fromTemplates], { title: t('Import profiles from') })
    : fromFiles;
  if (!source) return;
  const profiles = source.files ? await readProfileFiles(kit) : await pickTemplates(kit, t('Import templates'));
  if (!profiles.length) return;

  const loaded = kit.preset;
  const intoCurrent = { label: t('Add to the current preset'), current: true };
  const intoNew = { label: t('New preset file...'), current: false };
  const target = loaded
    ? await vscode.window.showQuickPick([intoCurrent, intoNew], { title: t('Where should the profiles go?') })
    : intoNew;
  if (!target) return;

  let uri: vscode.Uri;
  let result: { text: string; names: string[] };
  if (target.current && loaded) {
    result = addImportedProfiles(loaded.text, profiles, loaded.preset.core);
    uri = loaded.uri;
  } else {
    result = presetFromImported(profiles);
    const saved = await askNewPresetFile();
    if (!saved) return;
    uri = saved;
  }
  parsePresetText(result.text); // never write a preset that does not load
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(result.text));
  if (target.current) {
    await kit.loadPreset();
    await kit.refresh();
  } else if (!(await kit.usePreset(uri.fsPath))) return;
  await vscode.window.showTextDocument(uri);

  const skipped = [...new Set(profiles.flatMap((p) => p.notImported))];
  for (const p of profiles) for (const problem of p.problems) kit.log(`! ${p.name}: ${problem}`);
  void vscode.window.showInformationMessage(
    [
      t('Profiles added to the preset: {0}. Apply the preset to create them.', result.names.join(', ')),
      skipped.length ? t('Not imported (a preset holds extensions and settings): {0}', skipped.join(', ')) : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
