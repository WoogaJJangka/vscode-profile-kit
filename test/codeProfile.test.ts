import { describe, expect, it } from 'vitest';

import {
  addImportedProfiles,
  CodeProfileError,
  codeProfileFileName,
  MANAGED_KEYS_KEY,
  parseApplicationScoped,
  parseCodeProfile,
  parsePreset,
  parsePresetText,
  parseTemplateList,
  presetFromImported,
  PROFILE_MARKER_KEY,
  resolveProfile,
  serializeCodeProfile,
  templatesUrlFromProduct,
  toCodeProfile,
  uniqueProfileName,
} from '../src/core';
import { addProfile, PresetEditError, profileNamesIn, setCore } from '../src/core/presetEdit';

const preset = parsePreset({
  core: ['a.core', 'B.Core'],
  groups: { py: ['ms-python.python'] },
  settings: { 'editor.formatOnSave': true },
  profiles: {
    Py: { groups: ['py'], settings: { '[python]': { 'editor.tabSize': 4 } } },
    Shared: { shareFromDefault: { settings: true, keybindings: true } },
  },
});

/** Shaped like VS Code's own templates (docs/PLAN.md section 8-2): every value is JSON inside a string. */
const template = JSON.stringify({
  name: 'Data Science',
  icon: 'robot',
  settings: JSON.stringify({
    settings:
      '{\r\n    // comment\r\n    "[python]": { "editor.formatOnSave": true },\r\n    "notebook.lineNumbers": "on",\r\n}',
  }),
  snippets: JSON.stringify({ snippets: { 'python.json': '{}' } }),
  extensions: JSON.stringify([
    { identifier: { id: 'charliermarsh.ruff', uuid: 'c2ca9b43' }, displayName: 'Ruff', preRelease: true },
    { identifier: { id: 'MS-Python.Python' }, applicationScoped: true },
    { identifier: { id: 'x.off' }, disabled: true },
    { identifier: {} },
  ]),
  globalState: JSON.stringify({ storage: {} }),
});

describe('toCodeProfile', () => {
  it('writes extensions and the settings apply would write, each as a JSON string', () => {
    const info = new Map([['ms-python.python', { uuid: 'f1f59ae4', displayName: 'Python' }]]);
    const cp = toCodeProfile(preset, 'Py', info);
    expect(cp.name).toBe('Py');
    expect(JSON.parse(cp.extensions ?? '')).toEqual([
      { identifier: { id: 'a.core' } },
      { identifier: { id: 'b.core' } },
      { identifier: { id: 'ms-python.python', uuid: 'f1f59ae4' }, displayName: 'Python' },
    ]);
    const settings = JSON.parse((JSON.parse(cp.settings ?? '') as { settings: string }).settings) as Record<
      string,
      unknown
    >;
    expect(settings).toEqual({
      'editor.formatOnSave': true,
      '[python]': { 'editor.tabSize': 4 },
      [PROFILE_MARKER_KEY]: 'Py',
      [MANAGED_KEYS_KEY]: ['[python]', 'editor.formatOnSave', PROFILE_MARKER_KEY],
    });
    expect(cp.useDefaultFlags).toBeUndefined();
  });

  it('a profile sharing with Default gets useDefaultFlags and no settings', () => {
    const cp = toCodeProfile(preset, 'Shared');
    expect(cp.settings).toBeUndefined();
    expect(cp.useDefaultFlags).toEqual({ settings: true, keybindings: true });
  });

  it('round-trips through parseCodeProfile', () => {
    const back = parseCodeProfile(serializeCodeProfile(toCodeProfile(preset, 'Py')));
    expect(back.extensions).toEqual(resolveProfile(preset, 'Py'));
    // Profile Kit's own bookkeeping does not come back as settings
    expect(back.settings).toEqual({ 'editor.formatOnSave': true, '[python]': { 'editor.tabSize': 4 } });
    expect(codeProfileFileName('Py')).toBe('Py.code-profile');
  });
});

describe('parseCodeProfile', () => {
  it('reads a template-shaped file', () => {
    const p = parseCodeProfile(template);
    expect(p.name).toBe('Data Science');
    expect(p.extensions).toEqual(['charliermarsh.ruff', 'ms-python.python', 'x.off']);
    expect(p.applicationScoped).toEqual(['ms-python.python']);
    expect(p.disabled).toEqual(['x.off']);
    expect(p.settings).toEqual({ '[python]': { 'editor.formatOnSave': true }, 'notebook.lineNumbers': 'on' });
    expect(p.notImported).toEqual(['snippets', 'globalState']);
    expect(p.problems).toEqual(['extensions[3] has no extension ID']);
    expect(p.sharesSettings).toBe(false);
  });

  it('keeps going when settings are broken', () => {
    const p = parseCodeProfile(JSON.stringify({ name: 'X', settings: JSON.stringify({ settings: '{ "a": ' }) }));
    expect(p.settings).toBeUndefined();
    expect(p.problems[0]).toMatch(/settings were not imported/);
  });

  it('refuses what is not a profile file', () => {
    expect(() => parseCodeProfile('nope')).toThrow(CodeProfileError);
    expect(() => parseCodeProfile('{"core": []}')).toThrow(/no "name"/);
    expect(() => parseCodeProfile('{"name": "X", "extensions": []}')).toThrow(/must be a string/);
    expect(() => parseCodeProfile('{"name": "X", "extensions": "{}"}')).toThrow(/must be a list/);
  });
});

describe('importing into a preset', () => {
  it('unique, allowed profile names', () => {
    expect(uniqueProfileName('Node.js', [])).toBe('Node.js');
    expect(uniqueProfileName('C++ / Qt', [])).toBe('C-- - Qt');
    expect(uniqueProfileName('Default', [])).toBe('Default-imported');
    expect(uniqueProfileName('py', ['Py', 'py 2'])).toBe('py 3');
    expect(uniqueProfileName('???', [])).toBe('Imported');
  });

  it('adds profiles to preset text, leaving out what core already has', () => {
    const text = '{\n  // mine\n  "core": ["charliermarsh.ruff"],\n  "profiles": { "Data Science": {} }\n}\n';
    const { text: out, names } = addImportedProfiles(text, [parseCodeProfile(template)], ['charliermarsh.ruff']);
    expect(names).toEqual(['Data Science 2']);
    expect(out).toContain('// mine');
    const p = parsePresetText(out);
    expect(p.profiles['Data Science 2']).toEqual({
      extensions: ['ms-python.python', 'x.off'],
      settings: { '[python]': { 'editor.formatOnSave': true }, 'notebook.lineNumbers': 'on' },
    });
  });

  it('a new preset: what every profile shares becomes core', () => {
    const a = parseCodeProfile(serializeCodeProfile(toCodeProfile(preset, 'Py')));
    const b = parseCodeProfile(serializeCodeProfile(toCodeProfile(preset, 'Shared')));
    const { text, names } = presetFromImported([a, b]);
    expect(names).toEqual(['Py', 'Shared']);
    const p = parsePresetText(text);
    expect(p.core).toEqual(['a.core', 'b.core']);
    expect(p.profiles.Py.extensions).toEqual(['ms-python.python']);
    expect(p.profiles.Shared).toEqual({ shareFromDefault: { settings: true } });
    expect(resolveProfile(p, 'Py')).toEqual(resolveProfile(preset, 'Py'));
  });

  it('a new preset from one profile keeps everything in that profile', () => {
    const p = parsePresetText(presetFromImported([parseCodeProfile(template)]).text);
    expect(p.core).toEqual([]);
    expect(p.profiles['Data Science'].extensions).toHaveLength(3);
  });

  it('presetEdit helpers', () => {
    const text = '{ "core": [], "profiles": { "A": {} } }';
    expect(profileNamesIn(text)).toEqual(['A']);
    expect(() => addProfile(text, 'a', {})).toThrow(PresetEditError);
    expect(() => addProfile(text, 'Default', {})).toThrow(PresetEditError);
    expect(() => setCore(text, ['not an id'])).toThrow(PresetEditError);
    expect(parsePresetText(setCore(addProfile(text, 'B', { skipCore: true }), ['x.y'])).core).toEqual(['x.y']);
  });
});

describe('templates and extensions.json', () => {
  it('template URL from product.json, https only', () => {
    expect(templatesUrlFromProduct({ profileTemplatesUrl: 'https://cdn.example/t.json' })).toBe(
      'https://cdn.example/t.json',
    );
    expect(templatesUrlFromProduct({ profileTemplatesUrl: 'http://cdn.example/t.json' })).toBeUndefined();
    expect(templatesUrlFromProduct({})).toBeUndefined();
    expect(templatesUrlFromProduct(null)).toBeUndefined();
  });

  it('template list entries need a name and an https URL', () => {
    expect(
      parseTemplateList([
        { name: 'Python', url: 'https://cdn.example/python.code-profile' },
        { name: '', url: 'https://cdn.example/x' },
        { name: 'Bad', url: 'file:///etc/passwd' },
        'junk',
      ]),
    ).toEqual([{ name: 'Python', url: 'https://cdn.example/python.code-profile' }]);
    expect(parseTemplateList({})).toEqual([]);
  });

  it('extensions applied to all profiles', () => {
    const text = JSON.stringify([
      { identifier: { id: 'MS-CEINTL.vscode-language-pack-ko' }, metadata: { isApplicationScoped: true } },
      { identifier: { id: 'a.b' }, metadata: { isApplicationScoped: false } },
      { identifier: { id: 'c.d' } },
      { nothing: true },
    ]);
    expect(parseApplicationScoped(text)).toEqual(['ms-ceintl.vscode-language-pack-ko']);
    expect(() => parseApplicationScoped('{}')).toThrow();
  });
});
