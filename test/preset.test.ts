import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeId,
  parsePreset,
  parsePresetText,
  PresetError,
  profileNames,
  resolveProfile,
} from '../src/core/preset';

const example = JSON.parse(readFileSync(join(__dirname, '..', 'presets', 'example.json'), 'utf8')) as unknown;

function issuesOf(json: unknown): string[] {
  try {
    parsePreset(json);
  } catch (error) {
    if (error instanceof PresetError) return error.issues;
    throw error;
  }
  return [];
}

describe('parsePreset', () => {
  it('accepts the example preset', () => {
    expect(profileNames(parsePreset(example))).toEqual([
      'Core',
      'Python-Data',
      'Java',
      'C-Cpp',
      'Web-JS',
      'CSharp-Unity',
      'Go',
      'Docker-Infra',
    ]);
  });

  it('reports every problem at once', () => {
    const issues = issuesOf({
      core: ['not-an-id'],
      groups: { a: ['x.y'] },
      profiles: { Default: {}, 'Bad/Name': { groups: ['nope'], shareFromDefault: { colors: true } } },
      extra: 1,
    });
    expect(issues).toEqual(
      expect.arrayContaining([
        'unknown key "extra"',
        expect.stringContaining('core[0]'),
        'profiles.Default: the Default profile cannot be declared',
        expect.stringContaining('profiles.Bad/Name: profile name'),
        'profiles.Bad/Name.groups: unknown group "nope"',
        'profiles.Bad/Name.shareFromDefault: unknown key "colors"',
      ]),
    );
  });

  it('needs at least one profile', () => {
    expect(issuesOf({ core: [] })).toContain('profiles must be an object with at least one profile');
    expect(issuesOf({ profiles: {} })).toContain('profiles must be an object with at least one profile');
  });
});

describe('resolveProfile', () => {
  it('matches the counts from vscode-profiles-setup.ps1', () => {
    const preset = parsePreset(example);
    const counts = Object.fromEntries(profileNames(preset).map((n) => [n, resolveProfile(preset, n).length]));
    expect(counts).toEqual({
      Core: 27,
      'Python-Data': 42,
      Java: 34,
      'C-Cpp': 34,
      'Web-JS': 33,
      'CSharp-Unity': 31,
      Go: 28,
      'Docker-Infra': 31,
    });
  });

  it('keeps order, lower-cases and removes duplicates', () => {
    const preset = parsePreset({
      core: ['A.one', 'b.two'],
      groups: { g: ['b.TWO', 'c.three'] },
      profiles: { P: { groups: ['g'], extensions: ['a.one', 'd.four'] }, Q: { skipCore: true, groups: ['g'] } },
    });
    expect(resolveProfile(preset, 'P')).toEqual(['a.one', 'b.two', 'c.three', 'd.four']);
    expect(resolveProfile(preset, 'Q')).toEqual(['b.two', 'c.three']);
  });

  it('throws for an unknown profile', () => {
    expect(() => resolveProfile(parsePreset(example), 'Nope')).toThrow('Unknown profile');
  });
});

describe('normalizeId', () => {
  it('drops the version and lower-cases', () => {
    expect(normalizeId(' Ms-Python.Python@2026.1.0 ')).toBe('ms-python.python');
  });
});

describe('parsePresetText', () => {
  it('ignores a UTF-8 BOM', () => {
    const text = String.fromCharCode(0xfeff) + JSON.stringify({ profiles: { P: {} } });
    expect(profileNames(parsePresetText(text))).toEqual(['P']);
  });
});
