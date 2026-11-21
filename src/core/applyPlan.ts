/**
 * What `apply` would do to each declared profile: create it, install missing extensions, change settings.json keys.
 * Pure: the host collects the current state (storage.json, `--list-extensions`, settings.json, managed keys) and
 * this module only compares. Nothing here is ever uninstalled and Default is never a target (PLAN.md rules).
 */
import { applyEdits, modify } from 'jsonc-parser';

import { diffExtensions, type ExtensionDiff } from './diff';
import { type Preset, resolveProfile, type SettingsMap, stripBom } from './preset';
import { detectFormatting } from './presetEdit';
import type { StoredProfile } from './profiles';
import {
  APPLY_TO_ALL_PROFILES_KEY,
  diffSettings,
  isAppliedToAllProfiles,
  jsonEqual,
  resolveSettings,
  type SettingsChange,
  type SettingsPlan,
} from './settings';

/**
 * Written into every profile settings.json Profile Kit manages. The extension API cannot tell which profile a
 * window runs in (globalStorageUri is the same for all profiles, PLAN.md section 8), but each profile reads its own
 * settings.json, so this value names the current profile.
 */
export const PROFILE_MARKER_KEY = 'profileKit.profile';

/**
 * Keys Profile Kit wrote into a profile's settings.json, kept in that same file. Settings Sync copies settings.json
 * to other PCs, so the list has to travel with it: a list kept in globalStorage stayed behind, and on the other PC
 * Profile Kit's own keys looked like the user's and dropped keys were never removed (docs/REVIEW-2026-11-21.md, P3).
 */
export const MANAGED_KEYS_KEY = 'profileKit.managedKeys';

/** The managed-key list a settings.json holds, or undefined when it has none or it is malformed. */
export function managedKeysIn(settings: SettingsMap): string[] | undefined {
  const value = settings[MANAGED_KEYS_KEY];
  return Array.isArray(value) && value.every((k) => typeof k === 'string') ? value : undefined;
}

/** The edit that records `managed` in settings.json, or undefined when the file already has that list. */
export function managedKeysChange(current: SettingsMap, managed: readonly string[]): SettingsChange | undefined {
  const before = current[MANAGED_KEYS_KEY];
  if (jsonEqual(before, managed)) return undefined;
  return Object.prototype.hasOwnProperty.call(current, MANAGED_KEYS_KEY)
    ? { key: MANAGED_KEYS_KEY, kind: 'change', before, after: [...managed] }
    : { key: MANAGED_KEYS_KEY, kind: 'add', after: [...managed] };
}

export interface ProfileState {
  /** The profile as VS Code stores it; undefined when it does not exist yet. */
  stored?: StoredProfile;
  /** `--list-extensions` of the profile; undefined when the profile does not exist. */
  installed?: string[];
  /** Current settings.json content (`{}` when the file does not exist). */
  settings?: SettingsMap;
  /** Keys Profile Kit wrote last time: MANAGED_KEYS_KEY in settings.json, else the old managed-settings.json. */
  managed?: string[];
}

/** Default's settings.json, read once per plan: its values and the keys it applies to all profiles. */
export interface DefaultSettingsState {
  settings: SettingsMap;
  /** `workbench.settings.applyToAllProfiles` (see allProfilesKeys). */
  allProfiles: string[];
}

export interface ProfileApplyPlan {
  name: string;
  /** The profile does not exist and has to be created (opens a VS Code window). */
  create: boolean;
  /** `missing` is what gets installed; `extra` is only reported. */
  extensions: ExtensionDiff;
  /** Undefined when Profile Kit writes no settings for this profile (see `notes`). */
  settings?: SettingsPlan;
  /** Things the user should know, shown with the plan. */
  notes: string[];
}

const show = (v: unknown) => {
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
};

/**
 * Settings Profile Kit wants in a profile's settings.json, marker included; undefined when it shares with Default.
 * Keys Default applies to all profiles are left out: VS Code ignores them in a profile settings.json.
 */
export function desiredSettings(
  preset: Preset,
  name: string,
  allProfiles: readonly string[] = [],
): SettingsMap | undefined {
  const settings = resolveSettings(preset, name);
  if (settings === undefined) return undefined;
  // the managed-key list is Profile Kit's bookkeeping, written next to the changes (host/apply.ts), never a preset value
  const own = Object.fromEntries(
    Object.entries(settings).filter(([k]) => k !== MANAGED_KEYS_KEY && !isAppliedToAllProfiles(k, allProfiles)),
  );
  return { ...own, [PROFILE_MARKER_KEY]: name };
}

/**
 * Notes for the whole plan about keys Default applies to all profiles: preset common settings whose Default value
 * differs (Profile Kit never edits Default), and the marker, which must stay per profile.
 */
export function allProfilesNotes(preset: Preset, defaults: DefaultSettingsState): string[] {
  const notes: string[] = [];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(defaults.settings, k);
  for (const [key, value] of Object.entries(preset.settings)) {
    if (!isAppliedToAllProfiles(key, defaults.allProfiles)) continue;
    if (has(key) && jsonEqual(defaults.settings[key], value)) continue;
    notes.push(
      `${key}: every profile takes it from Default (${APPLY_TO_ALL_PROFILES_KEY}), where it is ` +
        `${has(key) ? show(defaults.settings[key]) : 'not set'} instead of the preset's ${show(value)}; ` +
        'Profile Kit does not edit Default, so change it there',
    );
  }
  if (defaults.allProfiles.includes(PROFILE_MARKER_KEY))
    notes.push(
      `${PROFILE_MARKER_KEY} is in ${APPLY_TO_ALL_PROFILES_KEY}; remove it there, ` +
        'or Profile Kit cannot tell which profile a window runs in',
    );
  return notes;
}

export function planProfile(
  preset: Preset,
  name: string,
  state: ProfileState,
  allProfiles: readonly string[] = [],
): ProfileApplyPlan {
  const notes: string[] = [];
  const create = !state.stored;
  const extensions = diffExtensions(resolveProfile(preset, name), state.installed ?? []);
  const desired = desiredSettings(preset, name, allProfiles);
  const vscodeShares = state.stored?.useDefaultFlags.settings === true;
  const presetShares = preset.profiles[name]?.shareFromDefault?.settings === true;

  let settings: SettingsPlan | undefined;
  if (presetShares) {
    notes.push('shareFromDefault.settings: this profile uses Default settings, so Profile Kit writes none for it');
    if (state.stored && !vscodeShares)
      notes.push(
        'VS Code does not share settings with Default for this profile yet; Profile Kit does not edit storage.json, ' +
          'so turn it on in the Profiles editor (Settings: use Default)',
      );
  } else if (vscodeShares) {
    notes.push(
      'VS Code uses Default settings for this profile (its own settings.json is ignored), so settings are skipped; ' +
        'turn sharing off in the Profiles editor (keys meant for every profile can stay shared with ' +
        '"Apply Setting to all Profiles") or set shareFromDefault.settings in the preset',
    );
  } else if (desired) {
    for (const key of Object.keys(preset.profiles[name]?.settings ?? {}))
      if (key !== PROFILE_MARKER_KEY && isAppliedToAllProfiles(key, allProfiles))
        notes.push(
          `${key}: Default applies it to all profiles (${APPLY_TO_ALL_PROFILES_KEY}), ` +
            'so this profile cannot have its own value; not written',
        );
    settings = diffSettings(state.settings ?? {}, desired, state.managed ?? []);
  }
  if (create) notes.push('profile does not exist: creating it opens a VS Code window');
  return { name, create, extensions, ...(settings ? { settings } : {}), notes };
}

export function planIsEmpty(plan: ProfileApplyPlan): boolean {
  return !plan.create && plan.extensions.missing.length === 0 && (plan.settings?.changes.length ?? 0) === 0;
}

/** Plan as text lines for the CLI and the extension's output channel. */
export function formatPlan(plans: readonly ProfileApplyPlan[]): string[] {
  const lines: string[] = [];
  for (const plan of plans) {
    const changes = plan.settings?.changes ?? [];
    const head = planIsEmpty(plan)
      ? 'up to date'
      : [
          plan.create ? 'create' : '',
          plan.extensions.missing.length ? `install ${plan.extensions.missing.length}` : '',
          changes.length ? `settings ${changes.length}` : '',
        ]
          .filter(Boolean)
          .join(', ');
    lines.push(`== ${plan.name}: ${head} ==`);
    for (const note of plan.notes) lines.push(`  ! ${note}`);
    for (const id of plan.extensions.missing) lines.push(`  + install ${id}`);
    for (const c of changes) {
      if (c.kind === 'add') lines.push(`  + set    ${c.key} = ${show(c.after)}`);
      else if (c.kind === 'change')
        lines.push(
          `  ~ set    ${c.key} = ${show(c.after)} (was ${show(c.before)})${c.overridesUser ? ' [overrides your value]' : ''}`,
        );
      else lines.push(`  - unset  ${c.key} (was ${show(c.before)}, no longer in the preset)`);
    }
    if (plan.extensions.extra.length)
      lines.push(`  (${plan.extensions.extra.length} installed but not declared; left as they are)`);
  }
  return lines;
}

/**
 * Why each extension is in a profile, for display: `core`, `group <name>` or `profile`.
 * First reason wins, in the order resolveProfile uses (core, groups, own extensions).
 */
export function extensionOrigins(preset: Preset, name: string): Map<string, string> {
  const spec = preset.profiles[name];
  const origins = new Map<string, string>();
  if (!spec) return origins;
  const add = (ids: readonly string[], why: string) => {
    for (const id of ids) {
      const key = id.toLowerCase();
      if (!origins.has(key)) origins.set(key, why);
    }
  };
  if (!spec.skipCore) add(preset.core, 'core');
  for (const g of spec.groups ?? []) add(preset.groups[g] ?? [], `group ${g}`);
  add(spec.extensions ?? [], 'profile');
  return origins;
}

/** Apply settings changes to settings.json text with jsonc-parser edits: comments and other keys stay as they are. */
export function editSettingsText(text: string, changes: readonly SettingsChange[]): string {
  const body0 = stripBom(text);
  const bom = text.slice(0, text.length - body0.length);
  let body = body0.trim() === '' ? '{}\n' : body0;
  // no indented line to copy yet: use VS Code's own settings.json style (4 spaces)
  const formattingOptions = /^[ \t]+\S/m.test(body)
    ? detectFormatting(body)
    : { insertSpaces: true, tabSize: 4, eol: body.includes('\r\n') ? '\r\n' : '\n' };
  for (const change of changes) {
    const value = change.kind === 'remove' ? undefined : change.after;
    body = applyEdits(body, modify(body, [change.key], value, { formattingOptions }));
  }
  return bom + body;
}
