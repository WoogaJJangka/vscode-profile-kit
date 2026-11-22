import { describe, expect, it } from 'vitest';

import { CORE_TARGET, membershipEdits, parsePreset, profilesWithExtension, recordOptions } from '../src/core';
import { galleryToMeta } from '../src/host/marketplace';

const preset = parsePreset({
  core: ['a.core'],
  groups: { py: ['ms-python.python'], data: ['x.data'] },
  profiles: {
    Python: { groups: ['py'] },
    Data: { groups: ['py', 'data'] },
    Web: {},
    Bare: { skipCore: true },
  },
});

const kinds = (chosen: string[]) =>
  recordOptions(preset, chosen).map((o) => [o.kind === 'group' ? `group ${o.group}` : o.kind, o.profiles, o.exact]);

describe('recordOptions', () => {
  it('core when "all profiles" is chosen', () => {
    expect(kinds([CORE_TARGET, 'Web'])).toEqual([['core', ['Python', 'Data', 'Web'], true]]);
  });

  it('a group used by exactly the chosen profiles comes first', () => {
    expect(kinds(['Python', 'Data'])).toEqual([
      ['group py', ['Python', 'Data'], true],
      ['profiles', ['Python', 'Data'], true],
      ['core', ['Python', 'Data', 'Web'], false],
    ]);
  });

  it('one profile: its own list, then broader groups (smallest first), then core', () => {
    expect(kinds(['Data'])).toEqual([
      ['group data', ['Data'], true],
      ['profiles', ['Data'], true],
      ['group py', ['Python', 'Data'], false],
      ['core', ['Python', 'Data', 'Web'], false],
    ]);
  });

  it('every profile that takes core chosen by hand: core first', () => {
    expect(kinds(['Python', 'Data', 'Web'])[0]).toEqual(['core', ['Python', 'Data', 'Web'], true]);
  });

  // the install flow records in options[0] without asking (1.1.0), so it must never give the extension to a
  // profile the user did not choose
  it('the first option gives it to exactly the chosen profiles, for every choice', () => {
    const names = ['Python', 'Data', 'Web', 'Bare'];
    for (let mask = 1; mask < 1 << names.length; mask++) {
      const chosen = names.filter((_, i) => mask & (1 << i));
      const [first] = recordOptions(preset, chosen);
      expect(first?.exact, chosen.join(',')).toBe(true);
      expect([...(first?.profiles ?? [])].sort(), chosen.join(',')).toEqual([...chosen].sort());
    }
    expect(recordOptions(preset, [CORE_TARGET])[0]?.exact).toBe(true);
  });

  it('unknown names are ignored; nothing chosen gives no options', () => {
    expect(recordOptions(preset, ['Nope'])).toEqual([]);
  });
});

describe('profilesWithExtension', () => {
  it('follows core, groups and skipCore', () => {
    expect(profilesWithExtension(preset, 'A.Core')).toEqual(['Python', 'Data', 'Web']);
    expect(profilesWithExtension(preset, 'ms-python.python')).toEqual(['Python', 'Data']);
    expect(profilesWithExtension(preset, 'none.here')).toEqual([]);
  });
});

describe('galleryToMeta', () => {
  it('reads ID, categories, public tags and dependency properties', () => {
    const meta = galleryToMeta({
      publisher: { publisherName: 'MS-Python' },
      extensionName: 'python',
      displayName: 'Python',
      categories: ['Programming Languages'],
      tags: ['__ext_py', 'python', 'linters'],
      versions: [
        {
          properties: [
            {
              key: 'Microsoft.VisualStudio.Code.ExtensionDependencies',
              value: 'ms-python.debugpy, ms-python.vscode-pylance',
            },
            { key: 'Microsoft.VisualStudio.Code.ExtensionPack', value: '' },
          ],
        },
      ],
    });
    expect(meta).toEqual({
      id: 'ms-python.python',
      displayName: 'Python',
      categories: ['Programming Languages'],
      keywords: ['python', 'linters'],
      extensionDependencies: ['ms-python.debugpy', 'ms-python.vscode-pylance'],
      extensionPack: [],
    });
  });

  it('returns undefined for entries without publisher or name', () => {
    expect(galleryToMeta({ extensionName: 'x' })).toBeUndefined();
    expect(galleryToMeta(null)).toBeUndefined();
  });
});

describe('membershipEdits', () => {
  const p = parsePreset({
    core: ['a.core'],
    groups: { py: ['ms-python.python', 'x.both'], data: ['x.both'] },
    profiles: {
      Python: { groups: ['py'], extensions: ['y.own'] },
      Data: { groups: ['py', 'data'] },
      Web: { extensions: ['y.own'] },
      Bare: { skipCore: true },
    },
  });
  const show = (id: string, want: string[]) => {
    const e = membershipEdits(p, id, want);
    const s = (t: { kind: string; name?: string }) => (t.kind === 'core' ? 'core' : `${t.kind} ${t.name}`);
    return { remove: e.remove.map(s), add: e.add.map(s) };
  };

  it('no change when the wanted set is what the preset already gives', () => {
    expect(show('ms-python.python', ['Python', 'Data'])).toEqual({ remove: [], add: [] });
    expect(show('a.core', ['Python', 'Data', 'Web'])).toEqual({ remove: [], add: [] });
  });

  it('unchecking one profile of a core extension moves it to the others own lists', () => {
    expect(show('a.core', ['Python', 'Data'])).toEqual({ remove: ['core'], add: ['profile Python', 'profile Data'] });
  });

  it('dropping a profile from a group extension does not edit the group for others when coverage still fits', () => {
    // x.both is in py (Python, Data) and data (Data): keep only Data -> py would give it to Python, so drop it from py
    expect(show('x.both', ['Data'])).toEqual({ remove: ['group py'], add: [] });
  });

  it('every profile that takes core: core, and the other lists are cleaned up', () => {
    expect(show('y.own', ['Python', 'Data', 'Web'])).toEqual({
      remove: ['profile Python', 'profile Web'],
      add: ['core'],
    });
  });

  it('a new extension goes to the own lists; skipCore profiles too', () => {
    expect(show('new.ext', ['Web', 'Bare'])).toEqual({ remove: [], add: ['profile Web', 'profile Bare'] });
  });

  it('unchecked everywhere removes it from every list', () => {
    expect(show('y.own', [])).toEqual({ remove: ['profile Python', 'profile Web'], add: [] });
  });
});
