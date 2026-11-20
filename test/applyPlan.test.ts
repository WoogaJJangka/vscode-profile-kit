import { describe, expect, it } from 'vitest';

import {
  editSettingsText,
  extensionOrigins,
  formatPlan,
  parsePreset,
  parseSettingsText,
  planIsEmpty,
  planProfile,
  PROFILE_MARKER_KEY,
  type StoredProfile,
} from '../src/core';

const preset = parsePreset({
  core: ['esbenp.prettier-vscode'],
  groups: { py: ['ms-python.python'] },
  settings: { 'editor.formatOnSave': true },
  profiles: {
    Python: { groups: ['py'], settings: { 'editor.tabSize': 4 } },
    Shared: { shareFromDefault: { settings: true } },
  },
});
const stored = (name: string, flags: Record<string, boolean> = {}): StoredProfile => ({
  name,
  location: `loc-${name}`,
  useDefaultFlags: flags,
});

describe('planProfile', () => {
  it('a missing profile is created, gets every extension and every setting plus the marker', () => {
    const plan = planProfile(preset, 'Python', {});
    expect(plan.create).toBe(true);
    expect(plan.extensions.missing).toEqual(['esbenp.prettier-vscode', 'ms-python.python']);
    expect(plan.settings?.changes.map((c) => [c.key, c.kind])).toEqual([
      ['editor.formatOnSave', 'add'],
      ['editor.tabSize', 'add'],
      [PROFILE_MARKER_KEY, 'add'],
    ]);
    expect(plan.notes.some((n) => n.includes('opens a VS Code window'))).toBe(true);
  });

  it('an up-to-date profile has nothing to do; extra extensions are only reported', () => {
    const plan = planProfile(preset, 'Python', {
      stored: stored('Python'),
      installed: ['esbenp.prettier-vscode', 'ms-python.python', 'ms-python.debugpy'],
      settings: { 'editor.formatOnSave': true, 'editor.tabSize': 4, [PROFILE_MARKER_KEY]: 'Python', 'my.own': 1 },
      managed: ['editor.formatOnSave', 'editor.tabSize', PROFILE_MARKER_KEY],
    });
    expect(planIsEmpty(plan)).toBe(true);
    expect(plan.extensions.extra).toEqual(['ms-python.debugpy']);
  });

  it('keys dropped from the preset are removed only when Profile Kit wrote them', () => {
    const plan = planProfile(preset, 'Python', {
      stored: stored('Python'),
      installed: [],
      settings: { 'old.managed': 1, 'user.key': 2 },
      managed: ['old.managed'],
    });
    const removed = plan.settings?.changes.filter((c) => c.kind === 'remove').map((c) => c.key);
    expect(removed).toEqual(['old.managed']);
  });

  it('shareFromDefault.settings writes no settings and says so', () => {
    const plan = planProfile(preset, 'Shared', { stored: stored('Shared', { settings: true }), installed: [] });
    expect(plan.settings).toBeUndefined();
    expect(plan.notes.join('\n')).toContain('shareFromDefault.settings');
  });

  it('a profile VS Code links to Default settings is skipped even if the preset has settings', () => {
    const plan = planProfile(preset, 'Python', { stored: stored('Python', { settings: true }), installed: [] });
    expect(plan.settings).toBeUndefined();
    expect(plan.notes.join('\n')).toContain('uses Default settings');
  });

  it('the preset asks to share but VS Code does not: a note, storage.json is not touched', () => {
    const plan = planProfile(preset, 'Shared', { stored: stored('Shared'), installed: [] });
    expect(plan.notes.join('\n')).toContain('does not edit storage.json');
  });
});

describe('formatPlan', () => {
  it('lists installs, settings and flags overwritten user values', () => {
    const plan = planProfile(preset, 'Python', {
      stored: stored('Python'),
      installed: ['esbenp.prettier-vscode'],
      settings: { 'editor.tabSize': 2 },
      managed: [],
    });
    const text = formatPlan([plan]).join('\n');
    expect(text).toContain('== Python: install 1, settings 3 ==');
    expect(text).toContain('+ install ms-python.python');
    expect(text).toContain('~ set    editor.tabSize = 4 (was 2) [overrides your value]');
  });
});

describe('editSettingsText', () => {
  it('keeps comments and other keys, adds, changes and removes', () => {
    const before = '{\n    // mine\n    "a": 1,\n    "b": 2\n}\n';
    const after = editSettingsText(before, [
      { key: 'a', kind: 'change', before: 1, after: 10 },
      { key: 'b', kind: 'remove', before: 2 },
      { key: 'c.d', kind: 'add', after: { x: true } },
    ]);
    expect(after).toContain('// mine');
    expect(parseSettingsText(after)).toEqual({ a: 10, 'c.d': { x: true } });
  });

  it('starts an empty file with 4-space indentation and keeps a BOM', () => {
    const out = editSettingsText('﻿', [{ key: 'x', kind: 'add', after: 1 }]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('\n    "x": 1');
    expect(parseSettingsText(out)).toEqual({ x: 1 });
  });
});

describe('extensionOrigins', () => {
  it('names the first place each extension comes from', () => {
    const p = parsePreset({
      core: ['A.Core', 'b.both'],
      groups: { g: ['b.both', 'c.group'] },
      profiles: { X: { groups: ['g'], extensions: ['d.own', 'c.group'] }, Bare: { skipCore: true } },
    });
    expect([...extensionOrigins(p, 'X')]).toEqual([
      ['a.core', 'core'],
      ['b.both', 'core'],
      ['c.group', 'group g'],
      ['d.own', 'profile'],
    ]);
    expect(extensionOrigins(p, 'Bare').size).toBe(0);
    expect(extensionOrigins(p, 'Nope').size).toBe(0);
  });
});
