import { readFileSync } from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  explainExtras,
  extraNote,
  parseExtensionManifest,
  PROFILE_KIT_ID,
  relationsById,
} from '../src/core/dependencies';

describe('parseExtensionManifest', () => {
  it('reads publisher.name, extensionDependencies and extensionPack (lower case, no duplicates)', () => {
    expect(
      parseExtensionManifest({
        publisher: 'MS-Toolsai',
        name: 'jupyter',
        extensionDependencies: ['ms-python.python', 'MS-Python.Python'],
        extensionPack: ['ms-toolsai.jupyter-keymap', 'ms-toolsai.jupyter-renderers'],
      }),
    ).toEqual({
      id: 'ms-toolsai.jupyter',
      relations: {
        dependencies: ['ms-python.python'],
        pack: ['ms-toolsai.jupyter-keymap', 'ms-toolsai.jupyter-renderers'],
      },
    });
  });

  it('ignores entries that are not extension IDs, and files that are not extension manifests', () => {
    expect(parseExtensionManifest({ publisher: 'a', name: 'b', extensionPack: [1, 'nodot', 'c.d'] })).toEqual({
      id: 'a.b',
      relations: { dependencies: [], pack: ['c.d'] },
    });
    expect(parseExtensionManifest({ name: 'b' })).toBeUndefined();
    expect(parseExtensionManifest({ publisher: '', name: 'b' })).toBeUndefined();
    expect(parseExtensionManifest([])).toBeUndefined();
    expect(parseExtensionManifest(null)).toBeUndefined();
  });
});

describe('relationsById', () => {
  it('merges several installed versions of one extension', () => {
    const merged = relationsById([
      { id: 'a.b', relations: { dependencies: ['x.y'], pack: [] } },
      { id: 'a.b', relations: { dependencies: ['x.y', 'x.z'], pack: ['p.q'] } },
      { id: 'c.d', relations: { dependencies: [], pack: [] } },
    ]);
    expect(merged.get('a.b')).toEqual({ dependencies: ['x.y', 'x.z'], pack: ['p.q'] });
    expect(merged.get('c.d')).toEqual({ dependencies: [], pack: [] });
  });
});

describe('explainExtras', () => {
  // the real case behind the change: CTF declares ms-toolsai.jupyter and ms-python.python, VS Code adds the rest
  const relations = relationsById([
    {
      id: 'ms-toolsai.jupyter',
      relations: {
        dependencies: ['ms-python.python'],
        pack: ['ms-toolsai.jupyter-keymap', 'ms-toolsai.jupyter-renderers'],
      },
    },
    { id: 'ms-python.python', relations: { dependencies: [], pack: ['ms-python.vscode-python-envs'] } },
    { id: 'xyc.vscode-mdx-preview', relations: { dependencies: [], pack: ['silvenon.mdx'] } },
    { id: 'self.ref', relations: { dependencies: ['self.ref'], pack: [] } },
  ]);

  it('names the installed extensions that need or bundle each extra', () => {
    const installed = [
      'ms-toolsai.jupyter',
      'ms-python.python',
      'ms-toolsai.jupyter-keymap',
      'ms-toolsai.jupyter-renderers',
      'ms-python.vscode-python-envs',
      'user.added',
    ];
    const extra = [
      'ms-toolsai.jupyter-keymap',
      'ms-toolsai.jupyter-renderers',
      'ms-python.vscode-python-envs',
      'user.added',
    ];
    const reasons = explainExtras(extra, installed, relations);
    expect(reasons.get('ms-toolsai.jupyter-keymap')).toEqual({ neededBy: [], inPack: ['ms-toolsai.jupyter'] });
    expect(reasons.get('ms-python.vscode-python-envs')).toEqual({ neededBy: [], inPack: ['ms-python.python'] });
    // nothing installed names it: the user (or something else) added it
    expect(reasons.has('user.added')).toBe(false);
    // declared extensions are not explained, even when another one needs them
    expect(reasons.has('ms-python.python')).toBe(false);
  });

  it('only counts extensions installed in the same profile', () => {
    // mdx-preview is installed in another profile only: silvenon.mdx here is not explained by it
    expect(explainExtras(['silvenon.mdx'], ['silvenon.mdx'], relations).size).toBe(0);
    expect(explainExtras(['silvenon.mdx'], ['silvenon.mdx', 'XYC.vscode-mdx-preview'], relations)).toEqual(
      new Map([['silvenon.mdx', { neededBy: [], inPack: ['xyc.vscode-mdx-preview'] }]]),
    );
  });

  it('an extension that names itself does not explain itself', () => {
    expect(explainExtras(['self.ref'], ['self.ref'], relations).size).toBe(0);
  });
});

describe('extraNote', () => {
  it('says why, or nothing', () => {
    expect(extraNote(undefined, false)).toBe('');
    expect(extraNote({ neededBy: [], inPack: [] }, false)).toBe('');
    expect(extraNote(undefined, true)).toBe(' (VS Code applies it to all profiles)');
    expect(extraNote({ neededBy: ['a.b', 'c.d'], inPack: ['p.q'] }, false)).toBe(
      ' (needed by a.b, c.d; in extension pack p.q)',
    );
  });
});

describe('PROFILE_KIT_ID', () => {
  it('is publisher.name from package.json', () => {
    const pkg = JSON.parse(readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')) as {
      publisher: string;
      name: string;
    };
    expect(PROFILE_KIT_ID).toBe(`${pkg.publisher}.${pkg.name}`);
  });
});
