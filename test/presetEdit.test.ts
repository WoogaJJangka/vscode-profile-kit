import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePresetText, resolveProfile } from '../src/core/preset';
import {
  addExtension,
  detectFormatting,
  PresetEditError,
  removeExtension,
  setSetting,
  type ExtensionTarget,
} from '../src/core/presetEdit';

const text = `{
  // every profile
  "core": [
    "a.one", // first
    "b.two"
  ],
  "groups": {
    /* python things */
    "py": ["ms-python.python"],
  },
  "settings": { "editor.formatOnSave": true },
  "profiles": {
    "Py": { "groups": ["py"] }, // python profile
    "Shared": { "shareFromDefault": { "settings": true } },
  },
}
`;

const BOM = String.fromCharCode(0xfeff);
const COMMENTS = ['// every profile', '// first', '/* python things */', '// python profile'];

function expectComments(out: string): void {
  for (const c of COMMENTS) expect(out).toContain(c);
}

describe('addExtension / removeExtension', () => {
  it.each<[string, ExtensionTarget, string, string[]]>([
    ['core', { kind: 'core' }, 'c.three', ['a.one', 'b.two', 'c.three', 'ms-python.python']],
    [
      'a group',
      { kind: 'group', name: 'py' },
      'charliermarsh.ruff',
      ['a.one', 'b.two', 'ms-python.python', 'charliermarsh.ruff'],
    ],
    [
      'a profile without extensions yet',
      { kind: 'profile', name: 'Py' },
      'x.y',
      ['a.one', 'b.two', 'ms-python.python', 'x.y'],
    ],
  ])('adds to %s and keeps comments', (_, target, id, wanted) => {
    const out = addExtension(text, target, id);
    expectComments(out);
    expect(resolveProfile(parsePresetText(out), 'Py')).toEqual(wanted);
  });

  it('adds nothing when the ID is already there (any case)', () => {
    expect(addExtension(text, { kind: 'core' }, 'A.One')).toBe(text);
  });

  it('removes every occurrence, case-insensitively, and keeps comments', () => {
    const twice = addExtension(addExtension(text, { kind: 'profile', name: 'Py' }, 'a.one'), { kind: 'core' }, 'z.z');
    const out = removeExtension(twice, { kind: 'core' }, 'A.ONE');
    // the comment on the removed line goes with it; the others stay
    expect(out).not.toContain('// first');
    expect(out).toContain('// python profile');
    const preset = parsePresetText(out);
    expect(preset.core).toEqual(['b.two', 'z.z']);
    expect(preset.profiles.Py.extensions).toEqual(['a.one']);
    expect(out).toContain('// every profile');
    expect(out).toContain('/* python things */');
  });

  it('removes nothing when the ID is not there', () => {
    expect(removeExtension(text, { kind: 'group', name: 'py' }, 'no.such')).toBe(text);
    expect(removeExtension(text, { kind: 'profile', name: 'Py' }, 'no.such')).toBe(text);
  });

  it.each<[string, ExtensionTarget, string, string]>([
    ['an unknown group', { kind: 'group', name: 'nope' }, 'a.b', 'group "nope" does not exist'],
    ['an unknown profile', { kind: 'profile', name: 'Nope' }, 'a.b', 'profile "Nope" does not exist'],
    ['a bad ID', { kind: 'core' }, 'not-an-id', 'not an extension ID'],
  ])('refuses %s', (_, target, id, message) => {
    expect(() => addExtension(text, target, id)).toThrow(PresetEditError);
    expect(() => addExtension(text, target, id)).toThrow(message);
  });

  it('creates core when the preset has none', () => {
    const out = addExtension('{ "profiles": { "P": {} } }', { kind: 'core' }, 'a.b');
    expect(parsePresetText(out).core).toEqual(['a.b']);
  });
});

describe('setSetting', () => {
  it.each<[string, Parameters<typeof setSetting>[1], string, unknown, (out: string) => void]>([
    [
      'changes a common setting',
      { kind: 'common' },
      'editor.formatOnSave',
      false,
      (out) => expect(parsePresetText(out).settings).toEqual({ 'editor.formatOnSave': false }),
    ],
    [
      'adds a common setting',
      { kind: 'common' },
      'files.eol',
      '\n',
      (out) => expect(parsePresetText(out).settings).toEqual({ 'editor.formatOnSave': true, 'files.eol': '\n' }),
    ],
    [
      'removes a common setting',
      { kind: 'common' },
      'editor.formatOnSave',
      undefined,
      (out) => expect(parsePresetText(out).settings).toEqual({}),
    ],
    [
      'creates profile settings',
      { kind: 'profile', name: 'Py' },
      '[python]',
      { 'editor.tabSize': 4 },
      (out) => expect(parsePresetText(out).profiles.Py.settings).toEqual({ '[python]': { 'editor.tabSize': 4 } }),
    ],
  ])('%s and keeps comments', (_, target, key, value, check) => {
    const out = setSetting(text, target, key, value);
    expectComments(out);
    check(out);
  });

  it('does nothing when removing a key that is not there', () => {
    expect(setSetting(text, { kind: 'profile', name: 'Py' }, 'no.such', undefined)).toBe(text);
  });

  it('refuses settings on a profile that shares settings with Default', () => {
    expect(() => setSetting(text, { kind: 'profile', name: 'Shared' }, 'a', 1)).toThrow('shares settings with Default');
  });

  it('refuses an unknown profile', () => {
    expect(() => setSetting(text, { kind: 'profile', name: 'Nope' }, 'a', 1)).toThrow('profile "Nope" does not exist');
  });
});

describe('formatting', () => {
  it.each([
    ['{\n    "a": 1\n}', { insertSpaces: true, tabSize: 4, eol: '\n' }],
    ['{\r\n\t"a": 1\r\n}', { insertSpaces: false, tabSize: 4, eol: '\r\n' }],
    ['{}', { insertSpaces: true, tabSize: 2, eol: '\n' }],
  ])('detects %j', (input, expected) => {
    expect(detectFormatting(input)).toEqual(expected);
  });

  it('keeps CRLF line endings and a BOM', () => {
    const crlf = BOM + text.replace(/\n/g, '\r\n');
    const out = addExtension(crlf, { kind: 'group', name: 'py' }, 'c.d');
    expect(out.startsWith(BOM)).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toContain('\n');
    expect(parsePresetText(out).groups.py).toEqual(['ms-python.python', 'c.d']);
  });

  it('leaves the example preset valid after an edit, with the same profile counts plus one', () => {
    const example = readFileSync(join(__dirname, '..', 'presets', 'example.json'), 'utf8');
    const out = addExtension(example, { kind: 'group', name: 'go' }, 'acme.go-extra');
    expect(resolveProfile(parsePresetText(out), 'Go')).toHaveLength(29);
    // only the go group line changed
    const changed = out.split('\n').filter((line, i) => line !== example.split('\n')[i]);
    expect(changed.join('\n')).toContain('acme.go-extra');
  });
});
