import { describe, expect, it } from 'vitest';

import { DEFAULT_PROFILE_ID } from '../src/core/compat';
import { folderKey, folderProfile, parseStorageProfiles } from '../src/core/profiles';

/** Trimmed from a real storage.json (VS Code 1.9x); IDs and paths made up. */
const storage = JSON.stringify({
  theme: 'vs-dark',
  userDataProfiles: [
    { location: '-6a5b1c2d', name: 'Python-Data', useDefaultFlags: { keybindings: true, snippets: false } },
    { location: '3f9e0a71', name: 'Web-JS', icon: 'globe' },
  ],
  profileAssociations: {
    workspaces: {
      'file:///d%3A/dev/projects/foo': '-6a5b1c2d',
      'file:///d%3A/dev/projects/bar': DEFAULT_PROFILE_ID,
      'file:///d%3A/dev/projects/gone': 'deadbeef',
    },
    emptyWindows: { '1700000000000': '3f9e0a71' },
  },
});

describe('parseStorageProfiles', () => {
  it('reads profiles and folder links', () => {
    expect(parseStorageProfiles(storage)).toEqual({
      profiles: [
        { name: 'Python-Data', location: '-6a5b1c2d', useDefaultFlags: { keybindings: true, snippets: false } },
        { name: 'Web-JS', location: '3f9e0a71', useDefaultFlags: {}, icon: 'globe' },
      ],
      folders: [
        { uri: 'file:///d%3A/dev/projects/foo', location: '-6a5b1c2d', profile: 'Python-Data' },
        { uri: 'file:///d%3A/dev/projects/bar', location: DEFAULT_PROFILE_ID, profile: 'Default' },
        { uri: 'file:///d%3A/dev/projects/gone', location: 'deadbeef' },
      ],
      emptyWindows: [{ uri: '1700000000000', location: '3f9e0a71', profile: 'Web-JS' }],
      problems: [],
    });
  });

  it('reads an old URI-object location', () => {
    const text = JSON.stringify({
      userDataProfiles: [
        {
          name: 'Old',
          location: { $mid: 1, scheme: 'file', path: '/c:/Users/u/AppData/Roaming/Code/User/profiles/abc123' },
        },
      ],
    });
    expect(parseStorageProfiles(text).profiles).toEqual([{ name: 'Old', location: 'abc123', useDefaultFlags: {} }]);
  });

  it.each([
    [
      'an empty file',
      '',
      0,
      ['storage.json has 1 syntax error(s); read what could be read', 'storage.json is not a JSON object'],
    ],
    ['not an object', '[]', 0, ['storage.json is not a JSON object']],
    ['no profile fields (only Default exists)', '{"theme":"x"}', 0, []],
    ['userDataProfiles is not a list', '{"userDataProfiles":{}}', 0, ['userDataProfiles is not a list']],
    [
      'broken entries are skipped',
      JSON.stringify({
        userDataProfiles: [
          'x',
          { location: 'a' },
          { name: 'NoLoc' },
          { name: 'Ok', location: 'b', useDefaultFlags: { settings: 'yes', tasks: true } },
          { name: 'Again', location: 'b' },
        ],
      }),
      1,
      [
        'userDataProfiles[0] is not an object',
        'userDataProfiles[1] has no name',
        'userDataProfiles[2] ("NoLoc") has no location',
        'userDataProfiles[4] ("Again") repeats location b',
      ],
    ],
    [
      'bad associations',
      JSON.stringify({ profileAssociations: { workspaces: { 'file:///x': 42 }, emptyWindows: [] } }),
      0,
      [
        'profileAssociations.workspaces["file:///x"] has no profile ID',
        'profileAssociations.emptyWindows is not an object',
      ],
    ],
    ['associations not an object', '{"profileAssociations":"x"}', 0, ['profileAssociations is not an object']],
    ['trailing comma and BOM', '\uFEFF{"userDataProfiles":[{"name":"P","location":"p"},]}', 1, []],
  ])('survives %s', (_, text, profileCount, problems) => {
    const info = parseStorageProfiles(text);
    expect(info.profiles).toHaveLength(profileCount);
    expect(info.problems).toEqual(problems);
  });

  it('keeps only boolean flags', () => {
    const info = parseStorageProfiles(
      JSON.stringify({
        userDataProfiles: [{ name: 'P', location: 'p', useDefaultFlags: { settings: 'yes', tasks: true } }],
      }),
    );
    expect(info.profiles[0].useDefaultFlags).toEqual({ tasks: true });
  });
});

describe('folderKey', () => {
  it.each([
    ['file:///d%3A/dev/projects/foo', '/d:/dev/projects/foo'],
    ['D:\\dev\\projects\\foo\\', '/d:/dev/projects/foo'],
    ['d:/Dev/Projects/Foo', '/d:/dev/projects/foo'],
    ['file:///home/u/My%20Project', '/home/u/My Project'],
    ['/home/u/Case', '/home/u/Case'],
    ['file:///bad%E0%A4%A', '/bad%E0%A4%A'],
  ])('%s → %s', (input, expected) => {
    expect(folderKey(input)).toBe(expected);
  });
});

describe('folderProfile', () => {
  const info = parseStorageProfiles(storage);

  it.each([
    ['D:\\dev\\projects\\foo', 'Python-Data'],
    ['file:///D%3A/dev/projects/bar/', 'Default'],
    ['D:\\dev\\projects\\other', undefined],
  ])('%s → %s', (folder, profile) => {
    expect(folderProfile(info, folder)?.profile).toBe(profile);
  });
});
