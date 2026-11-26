/**
 * One place for everything (status bar click, "Profile Kit: Show Menu"): the profiles to switch this window to,
 * then the actions that fit the current state. Without a preset it starts with the ways to get one, the
 * recommended built-in preset first.
 */
import * as path from 'node:path';

import * as vscode from 'vscode';

import { bestStarter, findStarter, needsChanges, recommendStarters } from '../core';
import type { Kit } from './kit';
import { collectSignals } from './starters';
import { profilePicks, switchTo } from './switch';

const t = vscode.l10n.t;

interface MenuItem extends vscode.QuickPickItem {
  run?: () => unknown;
}

const separator = (label: string): MenuItem => ({ label, kind: vscode.QuickPickItemKind.Separator });

function action(icon: string, label: string, description: string, id: string, ...args: unknown[]): MenuItem {
  return { label: `$(${icon}) ${label}`, description, run: () => vscode.commands.executeCommand(id, ...args) };
}

const guide = () => action('book', t('Get Started Guide'), t('the steps, one by one'), 'profileKit.getStarted');
const importItem = () =>
  action(
    'cloud-download',
    t('Import Profiles into Preset...'),
    t('.code-profile, VS Code templates'),
    'profileKit.importCodeProfile',
  );

async function startItems(kit: Kit): Promise<MenuItem[]> {
  const best = bestStarter(recommendStarters(await collectSignals(kit)));
  const starter = best ? findStarter(best.id) : undefined;
  return [
    separator(t('Start')),
    ...(starter
      ? [
          action(
            'star-full',
            t('Start from {0}', t(starter.title)),
            t('recommended for this PC'),
            'profileKit.startFromStarter',
            starter.id,
          ),
        ]
      : []),
    action('library', t('Start from a Built-in Preset...'), t('Python, Web, Java, ...'), 'profileKit.startFromStarter'),
    action(
      'person',
      t('Create Preset from This Profile...'),
      t('its extensions become core'),
      'profileKit.createPreset',
    ),
    action('folder-opened', t('Open Preset File...'), t('for example, from your repository'), 'profileKit.openPreset'),
    importItem(),
    guide(),
  ];
}

function presetItems(kit: Kit): MenuItem[] {
  const out: MenuItem[] = [separator(t('Preset'))];
  if (kit.presetMissing)
    out.push(action('warning', t('Preset file not found on this PC'), t('pick where it is'), 'profileKit.openPreset'));
  else if (kit.presetError)
    out.push(action('error', t('Preset has problems'), t('open it to fix'), 'profileKit.editPreset'));
  const loaded = kit.preset;
  if (loaded) {
    const status = kit.status();
    const todo = needsChanges(status).length;
    let state = t('extensions up to date');
    if (todo) state = t('{0} profile(s) need changes', todo);
    else if (status.checking.length) state = t('checking...');
    out.push(
      action('check-all', t('Apply Preset to All Profiles...'), state, 'profileKit.applyAll'),
      action('add', t('Install to Profiles...'), t('pick profiles for an extension'), 'profileKit.installToProfiles'),
      action('table', t('Open Manager'), t('extensions × profiles, settings'), 'profileKit.openManager'),
      action(
        'edit',
        t('Edit Preset'),
        kit.presetInSettings() ? kit.presetLabel() : path.basename(loaded.uri.fsPath),
        'profileKit.editPreset',
      ),
    );
  }
  out.push(
    separator(t('More')),
    action('folder-opened', t('Open Preset File...'), t('use another preset'), 'profileKit.openPreset'),
    kit.presetInSettings()
      ? action('file', t('Move Preset to a File...'), t('stop syncing it'), 'profileKit.movePresetToFile')
      : action(
          'sync',
          t('Store Preset in Settings (Sync)'),
          t('to use it on your other PCs'),
          'profileKit.storePresetInSettings',
        ),
    action('library', t('Start from a Built-in Preset...'), t('Python, Web, Java, ...'), 'profileKit.startFromStarter'),
    importItem(),
    ...(loaded
      ? [
          action(
            'export',
            t('Export Profiles as .code-profile...'),
            t("for VS Code's Profiles editor"),
            'profileKit.exportCodeProfile',
          ),
        ]
      : []),
    guide(),
  );
  return out;
}

function switchItems(kit: Kit): MenuItem[] {
  // Default alone is nothing to switch to
  if (!kit.profiles.length) return [];
  return [
    separator(t('Switch this window to')),
    ...profilePicks(kit).map((p): MenuItem => ({ ...p, run: () => switchTo(kit, p.name, p.location) })),
  ];
}

export async function showMenu(kit: Kit): Promise<void> {
  const hasPreset = kit.hasPreset();
  const items = hasPreset
    ? [...switchItems(kit), ...presetItems(kit)]
    : [...(await startItems(kit)), ...switchItems(kit)];
  const picked = await vscode.window.showQuickPick(items, {
    title: t('Profile Kit'),
    placeHolder: hasPreset ? t('Switch this window, or pick an action') : t('Pick how to start, or switch this window'),
    matchOnDescription: true,
  });
  await picked?.run?.();
}
