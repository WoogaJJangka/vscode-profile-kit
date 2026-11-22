/**
 * Built-in starter presets (core/starters.ts): which one fits this PC, shown in the Profiles view's welcome text
 * while there is no preset, and the command that writes the chosen one to a file and uses it.
 * Signals: the extensions of this window's profile, the names at the top of the open folders, the open files' languages.
 */
import * as vscode from 'vscode';

import {
  bestStarter,
  findStarter,
  profileNames,
  recommendStarters,
  type Starter,
  type StarterMatch,
  starterPresetText,
  type StarterRecommendation,
  type StarterSignals,
} from '../core';
import type { Kit } from './kit';
import { askNewPresetFile } from './presetFile';

const t = vscode.l10n.t;
const CONTEXT_KEY = 'profileKit.recommendedStarter';
/** Documents that are files the user works on (not output channels, git views, settings editors, ...). */
const DOCUMENT_SCHEMES = new Set(['file', 'untitled', 'vscode-notebook-cell']);

async function folderNames(): Promise<string[]> {
  const out: string[] = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    if (folder.uri.scheme !== 'file') continue;
    try {
      out.push(...(await vscode.workspace.fs.readDirectory(folder.uri)).map(([name]) => name));
    } catch {
      // an unreadable folder gives no signal
    }
  }
  return out;
}

function openLanguages(): string[] {
  const docs = vscode.workspace.textDocuments.filter((d) => DOCUMENT_SCHEMES.has(d.uri.scheme));
  const notebooks = vscode.workspace.notebookDocuments.some((n) => n.notebookType === 'jupyter-notebook')
    ? ['jupyter']
    : [];
  return [...new Set([...docs.map((d) => d.languageId), ...notebooks])];
}

export async function collectSignals(kit: Kit): Promise<StarterSignals> {
  return { extensions: kit.userExtensionIds(), files: await folderNames(), languages: openLanguages() };
}

const title = (s: Starter) => t(s.title);

/** "files pyproject.toml, *.py · open python files · 3 of its extensions installed" */
function matchText(m: StarterMatch): string {
  const shown = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(', ')}, …` : list.join(', '));
  return [
    m.files.length ? t('files {0}', shown(m.files)) : '',
    m.languages.length ? t('open {0} files', shown(m.languages)) : '',
    m.extensions.length ? t('{0} of its extensions installed', m.extensions.length) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Keeps `profileKit.recommendedStarter` (the welcome view's recommendation) current while there is no preset. */
export class StarterAdvisor implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private shown: string | undefined;

  constructor(private readonly kit: Kit) {
    const later = () => this.schedule();
    this.subscriptions.push(
      kit.onDidChange(later),
      vscode.workspace.onDidChangeWorkspaceFolders(later),
      vscode.extensions.onDidChange(later),
      vscode.workspace.onDidOpenTextDocument((d) => DOCUMENT_SCHEMES.has(d.uri.scheme) && later()),
      vscode.workspace.onDidOpenNotebookDocument(later),
    );
  }

  /** Coalesce bursts (a restored window opens many documents at once). */
  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.update(), 500);
  }

  async update(): Promise<void> {
    this.timer = undefined;
    const id = this.kit.hasPreset() ? '' : (bestStarter(recommendStarters(await collectSignals(this.kit)))?.id ?? '');
    if (id === this.shown) return;
    this.shown = id;
    await vscode.commands.executeCommand('setContext', CONTEXT_KEY, id);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const d of this.subscriptions) d.dispose();
  }
}

interface StarterItem extends vscode.QuickPickItem {
  starter: Starter;
}

async function pickStarter(ranked: readonly StarterRecommendation[]): Promise<Starter | undefined> {
  const best = bestStarter(ranked);
  const items: StarterItem[] = ranked.map((r) => {
    const s = findStarter(r.id)!;
    const why = r.score > 0 ? matchText(r.matched) : '';
    return {
      starter: s,
      label: r === best ? `$(star-full) ${title(s)}` : title(s),
      description: r === best ? t('Recommended') : why ? t('Also fits') : '',
      detail: [t(s.description), t('Profiles: {0}', profileNames(s.preset).join(', ')), why]
        .filter(Boolean)
        .join(' — '),
    };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: t('Start from a Built-in Preset'),
    placeHolder: best
      ? t('Recommended from the open folder, open files and installed extensions.')
      : t('No folder, open file or installed extension points to one; pick what you work on.'),
    matchOnDetail: true,
  });
  return picked?.starter;
}

/** Write a starter preset to a file the user picks and use it. `arg`: a starter ID (welcome view link) or nothing. */
export async function startFromStarter(kit: Kit, arg?: unknown): Promise<void> {
  const given = typeof arg === 'string' ? findStarter(arg) : undefined;
  const s = given ?? (await pickStarter(recommendStarters(await collectSignals(kit))));
  if (!s) return;
  const current = kit.presetLabel();
  if (current) {
    const use = t('Use New Preset');
    const answer = await vscode.window.showWarningMessage(
      t('Profile Kit uses {0} now. Create a preset from "{1}" and use it instead?', current, title(s)),
      { modal: true, detail: t('The current preset file is not changed or deleted.') },
      use,
    );
    if (answer !== use) return;
  }
  const target = await askNewPresetFile();
  if (!target) return;
  await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(starterPresetText(s)));
  if (!(await kit.usePreset(target.fsPath))) return;
  await vscode.window.showTextDocument(target);
  kit.log(`Preset created from starter ${s.id}: ${target.fsPath}`);

  const installed = new Set(kit.userExtensionIds());
  const declared = new Set([...s.preset.core, ...Object.values(s.preset.groups).flat()]);
  const notDeclared = [...installed].filter((id) => !declared.has(id)).length;
  const applyAll = t('Apply Preset to All Profiles...');
  const answer = await vscode.window.showInformationMessage(
    [
      t('Preset created from "{0}" with the profiles {1}.', title(s), profileNames(s.preset).join(', ')),
      t('Edit it as you like, then apply it to create the profiles.'),
      notDeclared
        ? t(
            '{0} extensions of this profile are not in it; nothing is uninstalled. Add them in the file or the manager.',
            notDeclared,
          )
        : '',
    ]
      .filter(Boolean)
      .join(' '),
    applyAll,
  );
  if (answer === applyAll) await vscode.commands.executeCommand('profileKit.applyAll');
}
