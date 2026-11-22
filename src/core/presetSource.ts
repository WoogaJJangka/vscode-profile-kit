/**
 * Where the preset comes from. Two places, both in Default's settings.json (application scope, one value for every
 * profile):
 * - `profileKit.preset`: the preset itself, as an object. Settings Sync takes it to the other PCs.
 * - `profileKit.presetPath`: a preset file on this PC. Not synced (`ignoreSync`), since paths differ per PC.
 * The synced preset wins when both are set (docs/PLAN.md section 12).
 */
import { isRecord, parseJsonc, type SettingsMap } from './preset';

export const PRESET_SETTING = 'profileKit.preset';
export const PRESET_PATH_SETTING = 'profileKit.presetPath';

export type PresetSource = { kind: 'settings'; value: Record<string, unknown> } | { kind: 'file'; file: string };

/** The preset source named by settings (Default's settings.json, or VS Code's view of it), or undefined for none. */
export function presetSourceFrom(preset: unknown, presetPath: unknown): PresetSource | undefined {
  if (isRecord(preset)) return { kind: 'settings', value: preset };
  const file = typeof presetPath === 'string' ? presetPath.trim() : '';
  return file ? { kind: 'file', file } : undefined;
}

/** Same as presetSourceFrom, from a parsed settings.json. */
export function presetSourceFromSettings(settings: SettingsMap): PresetSource | undefined {
  return presetSourceFrom(settings[PRESET_SETTING], settings[PRESET_PATH_SETTING]);
}

/** The synced preset as preset file text (2-space JSON), so the usual text edits and parsing apply to it. */
export function syncedPresetText(value: Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Preset file text → the value to store in `profileKit.preset`. Comments are dropped (a setting holds plain JSON)
 * and so is `$schema`, which only means something in a file. Throws on a syntax error or when it is not an object.
 * The preset rules are not checked here: a stored preset with problems is shown as one, like a file.
 */
export function syncedPresetValue(text: string): Record<string, unknown> {
  const json = parseJsonc(text, 'preset');
  if (!isRecord(json)) throw new Error('The preset must be a JSON object');
  return Object.fromEntries(Object.entries(json).filter(([key]) => key !== '$schema'));
}
