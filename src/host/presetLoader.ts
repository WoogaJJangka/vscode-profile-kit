/**
 * The CLI's preset: the file it was given, or else the one Profile Kit uses in VS Code, from Default's settings.json
 * (the synced `profileKit.preset`, then the file in `profileKit.presetPath`; src/core/presetSource.ts).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parsePreset, parsePresetText, type Preset, presetSourceFromSettings } from '../core';
import { userDataPaths } from './paths';
import { readSettingsFile } from './settingsWriter';

export interface LoadedCliPreset {
  preset: Preset;
  /** Where it came from, for the first line of the output. */
  from: string;
}

/**
 * `file` is the user's own CLI argument or their own setting: any path they can read is allowed.
 * Without `file`, `log` gets a line that says where the preset came from.
 */
export function loadCliPreset(
  file: string | undefined,
  userDataDir: string,
  log: (line: string) => void = () => undefined,
): LoadedCliPreset {
  if (file) return { preset: parsePresetText(readFileSync(file, 'utf8')), from: resolve(file) };
  const loaded = presetFromSettings(userDataDir);
  log(`Preset: ${loaded.from}\n`);
  return loaded;
}

function presetFromSettings(userDataDir: string): LoadedCliPreset {
  const settingsFile = userDataPaths(userDataDir).defaultSettings;
  const source = presetSourceFromSettings(readSettingsFile(settingsFile).settings);
  if (!source)
    throw new Error(
      `No preset given, and ${settingsFile} has neither profileKit.preset nor profileKit.presetPath. Pass <preset.json>.`,
    );
  if (source.kind === 'settings')
    return { preset: parsePreset(source.value), from: `profileKit.preset in ${settingsFile}` };
  return { preset: parsePresetText(readFileSync(source.file, 'utf8')), from: resolve(source.file) };
}
