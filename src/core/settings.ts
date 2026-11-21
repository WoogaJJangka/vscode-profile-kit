/**
 * Settings from the preset (common `settings` + `profiles.X.settings`) and the change list for a profile's settings.json.
 * Profile Kit only manages the keys it wrote before (the "managed" list kept by the host); every other key stays as is.
 */
import { isRecord, parseJsonc, stripBom, type Preset, type SettingsMap } from './preset';
import { compareCodeUnits } from './text';

/** `[python]`, `[javascript][typescript]`: language-specific blocks, which VS Code itself merges key by key. */
const LANGUAGE_BLOCK = /^\[[^\]]+\](\[[^\]]+\])*$/;

/**
 * Profile settings over common settings. Top-level keys are replaced, except language blocks
 * (`"[python]": {...}`) whose inner keys are merged, the same way VS Code merges them across scopes.
 */
export function mergeSettings(common: SettingsMap, profile: SettingsMap): SettingsMap {
  const out: SettingsMap = { ...common };
  for (const [key, value] of Object.entries(profile)) {
    const base = out[key];
    out[key] = LANGUAGE_BLOCK.test(key) && isRecord(base) && isRecord(value) ? { ...base, ...value } : value;
  }
  return out;
}

/**
 * What the preset wants in a profile's settings.json, or `undefined` when the profile shares settings with
 * Default (`shareFromDefault.settings: true`): then Profile Kit writes nothing for it.
 */
export function resolveSettings(preset: Preset, name: string): SettingsMap | undefined {
  const spec = preset.profiles[name];
  if (!spec) throw new Error(`Unknown profile "${name}"`);
  if (spec.shareFromDefault?.settings === true) return undefined;
  return mergeSettings(preset.settings, spec.settings ?? {});
}

/**
 * VS Code setting, kept in Default's settings.json, listing keys that every profile takes from Default
 * ("Apply Setting to all Profiles", VS Code 1.81+). Such a key cannot have a per-profile value: a profile's own
 * value is ignored, and writing it from any profile goes to Default. Language blocks (`"[html]"`) are not shared
 * this way even when listed. Tested in docs/PLAN.md section 8-1.
 */
export const APPLY_TO_ALL_PROFILES_KEY = 'workbench.settings.applyToAllProfiles';

/** The keys Default's settings.json applies to all profiles (`[]` when it lists none or the value is malformed). */
export function allProfilesKeys(defaultSettings: SettingsMap): string[] {
  const value = defaultSettings[APPLY_TO_ALL_PROFILES_KEY];
  return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : [];
}

/** True when VS Code takes `key` from Default in every profile, so a profile settings.json cannot set it. */
export function isAppliedToAllProfiles(key: string, allProfiles: readonly string[]): boolean {
  return !LANGUAGE_BLOCK.test(key) && allProfiles.includes(key);
}

/** Deep equality for JSON values (object key order does not matter). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (isRecord(a) && isRecord(b)) {
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}

export type SettingsChangeKind = 'add' | 'change' | 'remove';

export interface SettingsChange {
  key: string;
  kind: SettingsChangeKind;
  /** Value now in settings.json (absent for `add`). */
  before?: unknown;
  /** Value to write (absent for `remove`). */
  after?: unknown;
  /** The key was set by the user, not by Profile Kit, and is about to be overwritten. Show it in the preview. */
  overridesUser?: boolean;
}

export interface SettingsPlan {
  /** Sorted by key. Keys that already have the wanted value are not listed. */
  changes: SettingsChange[];
  /** Keys Profile Kit manages after these changes: the next `previouslyManaged`. */
  managed: string[];
}

/**
 * Changes that turn `current` (the profile's settings.json) into one that has `desired`.
 * A key in `previouslyManaged` that the preset no longer has is removed; keys never managed are not touched.
 */
export function diffSettings(
  current: SettingsMap,
  desired: SettingsMap,
  previouslyManaged: readonly string[],
): SettingsPlan {
  const has = (o: SettingsMap, k: string) => Object.prototype.hasOwnProperty.call(o, k);
  const wasManaged = new Set(previouslyManaged);
  const changes: SettingsChange[] = [];
  for (const [key, after] of Object.entries(desired)) {
    if (!has(current, key)) changes.push({ key, kind: 'add', after });
    else if (!jsonEqual(current[key], after))
      changes.push({
        key,
        kind: 'change',
        before: current[key],
        after,
        ...(wasManaged.has(key) ? {} : { overridesUser: true }),
      });
  }
  for (const key of wasManaged)
    if (!has(desired, key) && has(current, key)) changes.push({ key, kind: 'remove', before: current[key] });
  changes.sort((a, b) => compareCodeUnits(a.key, b.key));
  return { changes, managed: Object.keys(desired).sort(compareCodeUnits) };
}

/**
 * settings.json text → object. An empty or whitespace-only file is `{}` (VS Code creates it that way).
 * Throws JsoncSyntaxError on a syntax error, so a broken file is never overwritten by guesswork.
 */
export function parseSettingsText(text: string): SettingsMap {
  if (stripBom(text).trim() === '') return {};
  const value = parseJsonc(text, 'settings.json');
  if (!isRecord(value)) throw new Error('settings.json must contain a JSON object');
  return value;
}
