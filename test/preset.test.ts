import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  normalizeId,
  ownExtensions,
  parsePreset,
  parsePresetText,
  PresetError,
  PRESET_KEYS,
  PROFILE_KEYS,
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
      Core: 28,
      'Python-Data': 43,
      Java: 35,
      'C-Cpp': 35,
      'Web-JS': 34,
      'CSharp-Unity': 32,
      Go: 29,
      'Docker-Infra': 32,
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

describe('settings and match', () => {
  it('reads common settings, profile settings and match', () => {
    const preset = parsePreset({
      settings: { 'editor.formatOnSave': true },
      profiles: {
        P: {
          settings: { 'python.analysis.typeCheckingMode': 'basic' },
          match: { languages: ['python'], files: ['pyproject.toml', '*.ipynb'], keywords: ['data'] },
        },
      },
    });
    expect(preset.settings).toEqual({ 'editor.formatOnSave': true });
    expect(preset.profiles.P.settings).toEqual({ 'python.analysis.typeCheckingMode': 'basic' });
    expect(preset.profiles.P.match).toEqual({
      languages: ['python'],
      files: ['pyproject.toml', '*.ipynb'],
      keywords: ['data'],
    });
  });

  it('defaults common settings to {}', () => {
    expect(parsePreset({ profiles: { P: {} } }).settings).toEqual({});
  });

  it.each([
    [
      'shareFromDefault.settings with settings',
      { P: { shareFromDefault: { settings: true }, settings: { a: 1 } } },
      'profiles.P: settings cannot be used together with shareFromDefault.settings: true',
    ],
    [
      'settings not an object',
      { P: { settings: [] } },
      'profiles.P.settings must be an object of { "setting.key": value }',
    ],
    ['empty setting key', { P: { settings: { ' ': 1 } } }, 'profiles.P.settings: setting key must not be empty'],
    ['unknown match key', { P: { match: { exts: ['x'] } } }, 'profiles.P.match: unknown key "exts"'],
    [
      'match list of numbers',
      { P: { match: { languages: [1] } } },
      'profiles.P.match.languages must be an array of non-empty strings',
    ],
    [
      'path in match.files',
      { P: { match: { files: ['src/*.py'] } } },
      'profiles.P.match.files[0] must be a name without / or \\: "src/*.py"',
    ],
  ])('rejects %s', (_, profiles, issue) => {
    expect(issuesOf({ profiles })).toContain(issue);
  });

  it('allows shareFromDefault.settings: false with settings', () => {
    expect(issuesOf({ profiles: { P: { shareFromDefault: { settings: false }, settings: { a: 1 } } } })).toEqual([]);
  });

  it('rejects common settings that are not an object', () => {
    expect(issuesOf({ settings: 'x', profiles: { P: {} } })).toContain(
      'settings must be an object of { "setting.key": value }',
    );
  });
});

describe('schema', () => {
  interface Schema {
    properties: Record<string, unknown> & {
      profiles: { additionalProperties: { properties: Record<string, unknown> } };
    };
  }
  const schema = JSON.parse(readFileSync(join(__dirname, '..', 'schema', 'preset.schema.json'), 'utf8')) as Schema;

  it('has the same top-level keys as parsePreset', () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...PRESET_KEYS].sort());
  });

  it('rejects the same match.files names as parsePreset', () => {
    const match = (
      schema.properties.profiles.additionalProperties.properties.match as {
        properties: { files: { items: { pattern: string } } };
      }
    ).properties.files.items.pattern;
    const re = new RegExp(match);
    const backslash = String.fromCharCode(92);
    expect(['*.py', 'go.mod', 'Dockerfile', '.devcontainer'].map((n) => re.test(n))).toEqual([true, true, true, true]);
    expect([`src${backslash}a.py`, 'src/a.py', ' ', ''].map((n) => re.test(n))).toEqual([false, false, false, false]);
  });

  it('has the same profile keys as parsePreset', () => {
    expect(Object.keys(schema.properties.profiles.additionalProperties.properties).sort()).toEqual(
      [...PROFILE_KEYS].sort(),
    );
  });
});

describe('parsePresetText (JSONC)', () => {
  it('accepts comments and trailing commas', () => {
    const text = '{\n  // my profiles\n  "profiles": { "P": { /* none */ }, },\n}';
    expect(profileNames(parsePresetText(text))).toEqual(['P']);
  });

  it('turns a syntax error into PresetError', () => {
    expect(() => parsePresetText('{ "profiles": { "P": {} ')).toThrow(PresetError);
  });
});

describe('ownExtensions', () => {
  it('leaves out core extensions', () => {
    const preset = parsePreset({
      core: ['a.one'],
      groups: { g: ['A.ONE', 'b.two'] },
      profiles: { P: { groups: ['g'], extensions: ['c.three'] } },
    });
    expect(ownExtensions(preset, 'P')).toEqual(['b.two', 'c.three']);
  });
});
