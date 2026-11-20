import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parsePresetText } from '../src/core/preset';
import {
  CORE_TARGET,
  extensionLanguages,
  extensionMetaFromManifest,
  recommended,
  recommendProfiles,
  SCORE,
  type ExtensionMeta,
} from '../src/core/recommend';

const preset = parsePresetText(readFileSync(join(__dirname, '..', 'presets', 'example.json'), 'utf8'));

/** Metadata of declared extensions, trimmed to what the cases need. */
const known: ExtensionMeta[] = [
  { id: 'ms-vscode.cmake-tools', languages: ['cmake', 'cmake-cache'] },
  { id: 'vscjava.vscode-java-pack', extensionPack: ['vscjava.vscode-gradle', 'redhat.java'] },
  { id: 'ms-toolsai.jupyter', extensionPack: ['ms-toolsai.jupyter-keymap', 'ms-toolsai.jupyter-renderers'] },
  { id: 'ms-python.python', extensionDependencies: ['ms-python.debugpy'], languages: ['python', 'pip-requirements'] },
  { id: 'eamodio.gitlens', categories: ['SCM Providers'] },
];

describe('recommendProfiles', () => {
  const cases: {
    name: string;
    target: ExtensionMeta;
    /** Recommended entries (score > 0), in order, with their first reason. */
    expected: [profile: string, firstReason: string][];
  }[] = [
    {
      name: 'language and keyword overlap',
      target: {
        id: 'ms-python.black-formatter',
        categories: ['Formatters'],
        keywords: ['python', 'formatter'],
        activationEvents: ['onLanguage:python'],
      },
      expected: [['Python-Data', 'language python']],
    },
    {
      name: 'a theme goes to core',
      target: { id: 'dracula-theme.theme-dracula', categories: ['Themes'] },
      expected: [[CORE_TARGET, 'category Themes']],
    },
    {
      name: 'a language pack goes to core',
      target: { id: 'ms-ceintl.vscode-language-pack-ja', categories: ['Language Packs'] },
      expected: [[CORE_TARGET, 'category Language Packs']],
    },
    {
      name: 'depends on a profile extension',
      target: { id: 'acme.java-helper', extensionDependencies: ['RedHat.Java'] },
      expected: [['Java', 'depends on redhat.java']],
    },
    {
      name: 'is in an extension pack the profile has',
      target: { id: 'vscjava.vscode-gradle' },
      expected: [['Java', 'in extension pack vscjava.vscode-java-pack']],
    },
    {
      name: 'is needed by a profile extension',
      target: { id: 'ms-python.debugpy' },
      expected: [['Python-Data', 'needed by ms-python.python']],
    },
    {
      name: 'same languages as a profile extension (medium)',
      target: { id: 'acme.cmake-format', languages: ['cmake'] },
      expected: [['C-Cpp', 'same languages (cmake) as ms-vscode.cmake-tools']],
    },
    {
      name: 'only the ID is known',
      target: { id: 'golang.go-nightly' },
      expected: [['Go', 'ID mentions golang, go']],
    },
    {
      name: 'no signal at all goes to core',
      target: { id: 'gruntfuggly.todo-tree' },
      expected: [[CORE_TARGET, 'no language-specific signal']],
    },
    {
      name: 'a keymap bundled by a profile pack: the profile first, core second on a tie',
      target: { id: 'ms-toolsai.jupyter-keymap', categories: ['Keymaps'] },
      expected: [
        ['Python-Data', 'in extension pack ms-toolsai.jupyter'],
        [CORE_TARGET, 'category Keymaps'],
      ],
    },
    {
      name: 'depends on a core extension',
      target: { id: 'acme.gitlens-addon', extensionDependencies: ['eamodio.gitlens'] },
      expected: [[CORE_TARGET, 'depends on eamodio.gitlens']],
    },
    {
      name: 'several profiles, best first',
      target: { id: 'acme.polyglot', languages: ['go', 'java'], keywords: ['java'] },
      expected: [
        ['Java', 'language java'],
        ['Go', 'language go'],
      ],
    },
  ];

  it.each(cases)('$name', ({ target, expected }) => {
    const list = recommended(recommendProfiles(target, preset, known));
    expect(list.map((r) => [r.profile, r.reasons[0]])).toEqual(expected);
  });

  it('lists every profile and core once, recommended or not', () => {
    const list = recommendProfiles({ id: 'acme.x' }, preset);
    expect(list.map((r) => r.profile).sort()).toEqual([...Object.keys(preset.profiles), CORE_TARGET].sort());
  });

  it('adds up strong signals', () => {
    const [top] = recommendProfiles(
      { id: 'acme.py', languages: ['python'], keywords: ['jupyter'], extensionDependencies: ['ms-python.python'] },
      preset,
    );
    expect(top).toEqual({
      profile: 'Python-Data',
      score: 3 * SCORE.strong,
      reasons: ['language python', 'keyword jupyter', 'depends on ms-python.python'],
    });
  });

  it('does not count the extension itself as its own relation', () => {
    const list = recommendProfiles({ id: 'ms-python.python', languages: ['python'] }, preset, known);
    expect(list[0].reasons).toEqual(['language python']);
  });
});

describe('extensionMetaFromManifest', () => {
  it('reads the package.json fields', () => {
    expect(
      extensionMetaFromManifest('a.b', {
        categories: ['Programming Languages'],
        keywords: ['x'],
        contributes: { languages: [{ id: 'foo' }, { aliases: ['no id'] }] },
        activationEvents: ['onLanguage:bar', 'onStartupFinished'],
        extensionDependencies: ['c.d'],
        extensionPack: ['e.f'],
      }),
    ).toEqual({
      id: 'a.b',
      categories: ['Programming Languages'],
      keywords: ['x'],
      languages: ['foo'],
      activationEvents: ['onLanguage:bar', 'onStartupFinished'],
      extensionDependencies: ['c.d'],
      extensionPack: ['e.f'],
    });
  });

  it.each([null, 'text', [], { categories: 'Themes', contributes: { languages: 'x' }, keywords: [1, ''] }])(
    'tolerates a broken manifest: %j',
    (manifest) => {
      expect(extensionMetaFromManifest('a.b', manifest)).toEqual({
        id: 'a.b',
        categories: [],
        keywords: [],
        languages: [],
        activationEvents: [],
        extensionDependencies: [],
        extensionPack: [],
      });
    },
  );
});

describe('extensionLanguages', () => {
  it('joins contributed languages and onLanguage events, lower-case and once', () => {
    expect(
      extensionLanguages({
        id: 'a.b',
        languages: ['Python'],
        activationEvents: ['onLanguage:python', 'onLanguage:jupyter', 'onCommand:x'],
      }),
    ).toEqual(['python', 'jupyter']);
  });
});
