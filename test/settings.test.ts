import { describe, expect, it } from 'vitest';

import { JsoncSyntaxError, parsePreset } from '../src/core/preset';
import {
  diffSettings,
  jsonEqual,
  mergeSettings,
  parseSettingsText,
  resolveSettings,
  type SettingsChange,
} from '../src/core/settings';

describe('mergeSettings', () => {
  it.each([
    ['profile adds a key', { a: 1 }, { b: 2 }, { a: 1, b: 2 }],
    ['profile replaces a key', { a: 1 }, { a: 2 }, { a: 2 }],
    ['objects outside language blocks are replaced', { o: { x: 1 } }, { o: { y: 2 } }, { o: { y: 2 } }],
    [
      'language blocks are merged key by key',
      { '[python]': { 'editor.tabSize': 4, 'editor.rulers': [88] } },
      { '[python]': { 'editor.rulers': [100] } },
      { '[python]': { 'editor.tabSize': 4, 'editor.rulers': [100] } },
    ],
    [
      'multi-language blocks too',
      { '[javascript][typescript]': { a: 1 } },
      { '[javascript][typescript]': { b: 2 } },
      { '[javascript][typescript]': { a: 1, b: 2 } },
    ],
    ['null is a value, not a removal', { a: 1 }, { a: null }, { a: null }],
  ])('%s', (_, common, profile, expected) => {
    expect(mergeSettings(common, profile)).toEqual(expected);
  });

  it('does not change its inputs', () => {
    const common = { '[python]': { a: 1 } };
    mergeSettings(common, { '[python]': { b: 2 } });
    expect(common).toEqual({ '[python]': { a: 1 } });
  });
});

describe('resolveSettings', () => {
  const preset = parsePreset({
    settings: { 'editor.formatOnSave': true, 'files.eol': '\n' },
    profiles: {
      Py: { settings: { 'files.eol': '\r\n', 'python.analysis.typeCheckingMode': 'basic' } },
      Plain: {},
      Shared: { shareFromDefault: { settings: true } },
    },
  });

  it.each([
    ['Py', { 'editor.formatOnSave': true, 'files.eol': '\r\n', 'python.analysis.typeCheckingMode': 'basic' }],
    ['Plain', { 'editor.formatOnSave': true, 'files.eol': '\n' }],
    ['Shared', undefined],
  ])('%s', (name, expected) => {
    expect(resolveSettings(preset, name)).toEqual(expected);
  });

  it('throws for an unknown profile', () => {
    expect(() => resolveSettings(preset, 'Nope')).toThrow('Unknown profile');
  });
});

describe('jsonEqual', () => {
  it.each([
    [{ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 }, true],
    [[1, 2], [2, 1], false],
    [{ a: 1 }, { a: 1, b: undefined }, false],
    [null, {}, false],
    ['1', 1, false],
  ])('%j vs %j → %s', (a, b, expected) => {
    expect(jsonEqual(a, b)).toBe(expected);
  });
});

describe('diffSettings', () => {
  const cases: {
    name: string;
    current: Record<string, unknown>;
    desired: Record<string, unknown>;
    managed: string[];
    changes: SettingsChange[];
  }[] = [
    {
      name: 'adds missing keys',
      current: {},
      desired: { b: 2, a: 1 },
      managed: [],
      changes: [
        { key: 'a', kind: 'add', after: 1 },
        { key: 'b', kind: 'add', after: 2 },
      ],
    },
    {
      name: 'keeps keys that already have the value',
      current: { a: { x: [1] } },
      desired: { a: { x: [1] } },
      managed: ['a'],
      changes: [],
    },
    {
      name: 'changes a managed key without flagging it',
      current: { a: 1 },
      desired: { a: 2 },
      managed: ['a'],
      changes: [{ key: 'a', kind: 'change', before: 1, after: 2 }],
    },
    {
      name: 'flags a user key it is about to overwrite',
      current: { a: 1 },
      desired: { a: 2 },
      managed: [],
      changes: [{ key: 'a', kind: 'change', before: 1, after: 2, overridesUser: true }],
    },
    {
      name: 'removes a managed key the preset dropped',
      current: { a: 1, gone: true },
      desired: { a: 1 },
      managed: ['a', 'gone'],
      changes: [{ key: 'gone', kind: 'remove', before: true }],
    },
    {
      name: 'never touches keys it did not manage',
      current: { mine: 'user', 'workbench.colorTheme': 'x' },
      desired: {},
      managed: [],
      changes: [],
    },
    {
      name: 'ignores a managed key the user already deleted',
      current: {},
      desired: {},
      managed: ['gone'],
      changes: [],
    },
    {
      name: 'everything at once, sorted by key',
      current: { c: 1, b: 'old', u: 0 },
      desired: { b: 'new', a: true },
      managed: ['b', 'c'],
      changes: [
        { key: 'a', kind: 'add', after: true },
        { key: 'b', kind: 'change', before: 'old', after: 'new' },
        { key: 'c', kind: 'remove', before: 1 },
      ],
    },
  ];

  it.each(cases)('$name', ({ current, desired, managed, changes }) => {
    const plan = diffSettings(current, desired, managed);
    expect(plan.changes).toEqual(changes);
    expect(plan.managed).toEqual(Object.keys(desired).sort());
  });
});

describe('parseSettingsText', () => {
  it.each([
    ['', {}],
    ['  \n', {}],
    [String.fromCharCode(0xfeff) + '{}', {}],
    ['{\n  // comment\n  "a": 1,\n}', { a: 1 }],
  ])('%j', (text, expected) => {
    expect(parseSettingsText(text)).toEqual(expected);
  });

  it('throws on a broken file instead of guessing', () => {
    expect(() => parseSettingsText('{ "a": ')).toThrow(JsoncSyntaxError);
  });

  it('throws when the file is not an object', () => {
    expect(() => parseSettingsText('[1]')).toThrow('must contain a JSON object');
  });
});
