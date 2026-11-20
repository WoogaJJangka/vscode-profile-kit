import { describe, expect, it } from 'vitest';

import { CORE_TARGET, parsePreset, profilesWithExtension, recordOptions } from '../src/core';
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
