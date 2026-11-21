import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCodeProfile, parsePreset } from '../src/core';
import {
  exportCodeProfiles,
  fetchTemplates,
  readApplicationScoped,
  realFileInside,
  readTemplatesUrl,
  syncedBefore,
} from '../src/host/builtins';
import type { GalleryExtension } from '../src/host/marketplace';
import { defaultExtensionsDir, userDataPaths } from '../src/host/paths';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'pk-builtins-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('files VS Code leaves on disk (read only)', () => {
  it('extensions applied to all profiles; missing or broken extensions.json means none', () => {
    expect(readApplicationScoped(dir)).toEqual({ ids: [] });
    writeFileSync(
      path.join(dir, 'extensions.json'),
      JSON.stringify([{ identifier: { id: 'A.B' }, metadata: { isApplicationScoped: true } }]),
    );
    expect(readApplicationScoped(dir)).toEqual({ ids: ['a.b'] });
    writeFileSync(path.join(dir, 'extensions.json'), '{ broken');
    const broken = readApplicationScoped(dir);
    expect(broken.ids).toEqual([]);
    expect(broken.problem).toMatch(/could not be read/);
  });

  it('reads a file only when its real path is inside the folder', () => {
    const inner = path.join(dir, 'ext');
    mkdirSync(inner);
    expect(realFileInside(inner, 'extensions.json')).toBeUndefined();
    writeFileSync(path.join(inner, 'extensions.json'), '[]');
    expect(realFileInside(inner, 'extensions.json')).toBe(realpathSync(path.join(inner, 'extensions.json')));
    expect(realFileInside(inner, path.join('..', 'outside.json'))).toBeUndefined();

    // a symbolic link to a file elsewhere (needs symlink rights; Windows without them skips this part)
    const outside = path.join(dir, 'outside.json');
    writeFileSync(outside, JSON.stringify([{ identifier: { id: 'x.y' }, metadata: { isApplicationScoped: true } }]));
    const linkDir = path.join(dir, 'linked');
    mkdirSync(linkDir);
    try {
      symlinkSync(outside, path.join(linkDir, 'extensions.json'), 'file');
    } catch {
      return;
    }
    expect(realFileInside(linkDir, 'extensions.json')).toBeUndefined();
    const read = readApplicationScoped(linkDir);
    expect(read.ids).toEqual([]);
    expect(read.problem).toMatch(/points outside/);
  });

  it('Settings Sync folder', () => {
    const paths = userDataPaths(dir);
    expect(syncedBefore(paths)).toBe(false);
    mkdirSync(path.join(dir, 'User', 'sync', 'settings'), { recursive: true });
    expect(syncedBefore(paths)).toBe(true);
  });

  it('template URL from product.json', () => {
    expect(readTemplatesUrl(dir)).toBeUndefined();
    writeFileSync(
      path.join(dir, 'product.json'),
      JSON.stringify({ profileTemplatesUrl: 'https://cdn.example/t.json' }),
    );
    expect(readTemplatesUrl(dir)).toBe('https://cdn.example/t.json');
  });

  it('default extensions folder', () => {
    expect(defaultExtensionsDir({}, 'H')).toBe(path.join('H', '.vscode', 'extensions'));
    expect(defaultExtensionsDir({ VSCODE_PORTABLE: 'P' }, 'H')).toBe(path.join('P', 'extensions'));
  });
});

describe('fetchTemplates', () => {
  const pages: Record<string, string> = {
    'https://cdn.example/t.json': JSON.stringify([
      { name: 'Python', url: 'https://cdn.example/python.code-profile' },
      { name: 'Gone', url: 'https://cdn.example/gone.code-profile' },
    ]),
    'https://cdn.example/python.code-profile': JSON.stringify({
      name: 'Python',
      extensions: JSON.stringify([{ identifier: { id: 'ms-python.python' } }]),
    }),
  };
  const fakeFetch = (url: string) =>
    Promise.resolve({
      ok: url in pages,
      status: url in pages ? 200 : 404,
      text: () => Promise.resolve(pages[url] ?? ''),
    });

  it('reads the list and each template; a failed template carries its error', async () => {
    const got = await fetchTemplates('https://cdn.example/t.json', { fetch: fakeFetch });
    expect(got.map((t) => t.name)).toEqual(['Python', 'Gone']);
    expect(got[0].profile?.extensions).toEqual(['ms-python.python']);
    expect(got[1].error).toMatch(/404/);
  });

  it('throws when the list itself fails', async () => {
    await expect(fetchTemplates('https://cdn.example/none.json', { fetch: fakeFetch })).rejects.toThrow(/404/);
  });
});

describe('exportCodeProfiles', () => {
  const preset = parsePreset({ core: ['a.b'], profiles: { One: {}, Two: { extensions: ['c.d'] } } });

  it('writes one file per profile with Marketplace GUIDs', async () => {
    const query = (ids: readonly string[]) =>
      Promise.resolve(
        new Map<string, GalleryExtension>(
          ids.map((id) => [id, { id, uuid: `uuid-${id}`, categories: [], keywords: [] } as GalleryExtension]),
        ),
      );
    const out = path.join(dir, 'out');
    const result = await exportCodeProfiles(preset, ['One', 'Two'], out, { query });
    expect(result.withoutUuids).toBe(false);
    expect(result.files.map((f) => path.basename(f))).toEqual(['One.code-profile', 'Two.code-profile']);
    const two = JSON.parse(readFileSync(result.files[1], 'utf8')) as { extensions: string };
    expect(JSON.parse(two.extensions)).toEqual([
      { identifier: { id: 'a.b', uuid: 'uuid-a.b' } },
      { identifier: { id: 'c.d', uuid: 'uuid-c.d' } },
    ]);
    expect(parseCodeProfile(readFileSync(result.files[0], 'utf8')).name).toBe('One');
  });

  it('without the Marketplace the files have IDs only', async () => {
    const result = await exportCodeProfiles(preset, ['One'], dir, {
      query: () => Promise.reject(new Error('offline')),
    });
    expect(result.withoutUuids).toBe(true);
    const one = JSON.parse(readFileSync(result.files[0], 'utf8')) as { extensions: string };
    expect(JSON.parse(one.extensions)).toEqual([{ identifier: { id: 'a.b' } }]);
  });
});
