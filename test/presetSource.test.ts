import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  addExtension,
  parsePreset,
  parsePresetText,
  presetSourceFrom,
  presetSourceFromSettings,
  profileNames,
  resolveProfile,
  syncedPresetText,
  syncedPresetValue,
} from '../src/core';

const exampleText = readFileSync(join(__dirname, '..', 'presets', 'example.json'), 'utf8');

describe('presetSourceFrom', () => {
  it('uses the synced preset first, then the file', () => {
    const value = { profiles: { Core: {} } };
    expect(presetSourceFrom(value, 'D:\\p.json')).toEqual({ kind: 'settings', value });
    expect(presetSourceFrom(undefined, ' D:\\p.json ')).toEqual({ kind: 'file', file: 'D:\\p.json' });
    expect(presetSourceFrom(null, '')).toBeUndefined();
  });

  it('ignores values that are not a preset object', () => {
    expect(presetSourceFrom([], 'a.json')).toEqual({ kind: 'file', file: 'a.json' });
    expect(presetSourceFrom('text', undefined)).toBeUndefined();
    expect(presetSourceFrom(undefined, 3)).toBeUndefined();
  });

  it('reads both from a settings.json', () => {
    expect(presetSourceFromSettings({ 'profileKit.presetPath': 'x.json' })).toEqual({ kind: 'file', file: 'x.json' });
    expect(presetSourceFromSettings({ 'profileKit.preset': { a: 1 }, 'profileKit.presetPath': 'x.json' })).toEqual({
      kind: 'settings',
      value: { a: 1 },
    });
  });
});

describe('synced preset text', () => {
  it('round-trips the example preset, without $schema', () => {
    const value = syncedPresetValue(exampleText);
    expect(value).not.toHaveProperty('$schema');
    const text = syncedPresetText(value);
    const preset = parsePresetText(text);
    expect(profileNames(preset)).toEqual(profileNames(parsePresetText(exampleText)));
    expect(parsePreset(value)).toEqual(preset);
  });

  it('takes JSON with comments and trailing commas, as in a preset file', () => {
    expect(syncedPresetValue('{ // core\n "core": ["a.b",], "profiles": { "Core": {} }, }')).toEqual({
      core: ['a.b'],
      profiles: { Core: {} },
    });
  });

  it('refuses text that a setting cannot hold', () => {
    expect(() => syncedPresetValue('{ "core": [')).toThrow(/not valid JSON/);
    expect(() => syncedPresetValue('[1, 2]')).toThrow('The preset must be a JSON object');
  });

  it('keeps working with the text edits the UI makes', () => {
    const text = syncedPresetText(syncedPresetValue(exampleText));
    const edited = addExtension(text, { kind: 'group', name: 'go' }, 'acme.go-extra');
    expect(resolveProfile(parsePreset(syncedPresetValue(edited)), 'Go')).toContain('acme.go-extra');
    // the stored text keeps the 2-space layout, so an edit changes only the lines it touches
    expect(edited.split('\n').length).toBe(text.split('\n').length + 1);
  });
});
