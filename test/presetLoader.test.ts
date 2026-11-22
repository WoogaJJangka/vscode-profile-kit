import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PresetError, profileNames } from '../src/core';
import { loadCliPreset } from '../src/host/presetLoader';

const PRESET = { core: ['a.b'], profiles: { Core: {}, Go: { extensions: ['golang.go'] } } };

describe('loadCliPreset', () => {
  let dir: string;
  let userData: string;
  let settingsFile: string;
  const writeSettings = (settings: Record<string, unknown>) =>
    writeFileSync(settingsFile, `// VS Code settings\n${JSON.stringify(settings, null, 4)}`);

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'pk-loader-'));
    userData = path.join(dir, 'ud');
    mkdirSync(path.join(userData, 'User'), { recursive: true });
    settingsFile = path.join(userData, 'User', 'settings.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the file it is given', () => {
    const file = path.join(dir, 'given.profile-kit.json');
    writeFileSync(file, JSON.stringify(PRESET));
    writeSettings({ 'profileKit.preset': { profiles: { Other: {} } } });
    const lines: string[] = [];
    const loaded = loadCliPreset(file, userData, (l) => lines.push(l));
    expect(profileNames(loaded.preset)).toEqual(['Core', 'Go']);
    expect(loaded.from).toBe(path.resolve(file));
    expect(lines).toEqual([]);
  });

  it('without a file, uses the synced preset in Default settings.json first', () => {
    const file = path.join(dir, 'unused.json');
    writeSettings({ 'profileKit.preset': PRESET, 'profileKit.presetPath': file });
    const lines: string[] = [];
    const loaded = loadCliPreset(undefined, userData, (l) => lines.push(l));
    expect(profileNames(loaded.preset)).toEqual(['Core', 'Go']);
    expect(loaded.from).toBe(`profileKit.preset in ${settingsFile}`);
    expect(lines).toEqual([`Preset: profileKit.preset in ${settingsFile}\n`]);
  });

  it('without a synced preset, reads the file in profileKit.presetPath', () => {
    const file = path.join(dir, 'mine.profile-kit.json');
    writeFileSync(file, JSON.stringify(PRESET));
    writeSettings({ 'profileKit.presetPath': file });
    expect(loadCliPreset(undefined, userData).from).toBe(path.resolve(file));
  });

  it('reports a synced preset with problems like a file', () => {
    writeSettings({ 'profileKit.preset': { profiles: { Default: {} } } });
    expect(() => loadCliPreset(undefined, userData)).toThrow(PresetError);
  });

  it('says what to do when there is no preset at all', () => {
    writeSettings({ 'editor.fontSize': 14 });
    expect(() => loadCliPreset(undefined, userData)).toThrow(/neither profileKit\.preset nor profileKit\.presetPath/);
    rmSync(settingsFile);
    expect(() => loadCliPreset(undefined, userData)).toThrow(/Pass <preset\.json>/);
  });
});
