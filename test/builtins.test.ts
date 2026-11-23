import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseCodeProfile, parsePreset } from '../src/core';
import {
  exportCodeProfiles,
  type InstalledManifest,
  fetchTemplates,
  readApplicationScoped,
  readExtensionRelations,
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
    writeFileSync(path.join(dir, 'extensions.json'), 'secret-token-123 { broken');
    const broken = readApplicationScoped(dir);
    expect(broken.ids).toEqual([]);
    expect(broken.problem).toMatch(/could not be read.*not valid JSON/);
    // the message never quotes the file's content
    expect(broken.problem).not.toContain('secret-token');
  });

  it('a missing folder means none; extensions.json linking outside the folder is not read', () => {
    expect(readApplicationScoped(path.join(dir, 'no-such-folder'))).toEqual({ ids: [] });

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
    const read = readApplicationScoped(linkDir);
    expect(read.ids).toEqual([]);
    expect(read.problem).toMatch(/points outside/);
  });

  it('what installed extensions need or bundle, from each folder package.json', async () => {
    const ext = (folder: string, manifest: unknown) => {
      mkdirSync(path.join(dir, folder));
      writeFileSync(path.join(dir, folder, 'package.json'), JSON.stringify(manifest));
    };
    ext('ms-toolsai.jupyter-2025.1.0', {
      publisher: 'ms-toolsai',
      name: 'jupyter',
      extensionDependencies: ['ms-python.python'],
      extensionPack: ['ms-toolsai.jupyter-keymap'],
    });
    // an older version VS Code has not removed yet: merged
    ext('ms-toolsai.jupyter-2024.9.0', { publisher: 'ms-toolsai', name: 'jupyter', extensionPack: ['old.member'] });
    ext('plain.one-1.0.0', { publisher: 'plain', name: 'one' });
    // VS Code unpacks into a dot folder first; broken and missing manifests are skipped
    ext('.1234-unpacking', { publisher: 'x', name: 'half', extensionPack: ['x.y'] });
    mkdirSync(path.join(dir, 'broken-1.0.0'));
    writeFileSync(path.join(dir, 'broken-1.0.0', 'package.json'), '{ nope');
    mkdirSync(path.join(dir, 'empty-1.0.0'));
    writeFileSync(path.join(dir, 'extensions.json'), '[]');

    const cache = new Map<string, InstalledManifest | null>();
    const relations = await readExtensionRelations(dir, cache);
    expect([...relations.keys()].sort()).toEqual(['ms-toolsai.jupyter', 'plain.one']);
    expect(relations.get('ms-toolsai.jupyter')).toEqual({
      dependencies: ['ms-python.python'],
      pack: ['ms-toolsai.jupyter-keymap', 'old.member'],
    });

    // folder names carry the version, so a cached folder is not read again; a removed one is dropped
    rmSync(path.join(dir, 'plain.one-1.0.0', 'package.json'));
    rmSync(path.join(dir, 'ms-toolsai.jupyter-2024.9.0'), { recursive: true });
    const again = await readExtensionRelations(dir, cache);
    expect(again.has('plain.one')).toBe(true);
    expect(again.get('ms-toolsai.jupyter')?.pack).toEqual(['ms-toolsai.jupyter-keymap']);

    expect((await readExtensionRelations(path.join(dir, 'no-such-folder'))).size).toBe(0);
    // a folder without VS Code's extensions.json is not an extensions folder VS Code used: not listed
    rmSync(path.join(dir, 'extensions.json'));
    expect((await readExtensionRelations(dir)).size).toBe(0);
  });

  it('an extension folder linked from outside the extensions folder is not read', async () => {
    const outside = path.join(dir, 'outside');
    mkdirSync(outside);
    writeFileSync(
      path.join(outside, 'package.json'),
      JSON.stringify({ publisher: 'x', name: 'y', extensionPack: ['p.q'] }),
    );
    const extDir = path.join(dir, 'extensions');
    mkdirSync(extDir);
    writeFileSync(path.join(extDir, 'extensions.json'), '[]');
    mkdirSync(path.join(extDir, 'a.b-1.0.0'));
    writeFileSync(path.join(extDir, 'a.b-1.0.0', 'package.json'), JSON.stringify({ publisher: 'a', name: 'b' }));
    try {
      symlinkSync(outside, path.join(extDir, 'x.y-1.0.0'), 'junction');
    } catch {
      return; // no symlink rights
    }
    expect([...(await readExtensionRelations(extDir)).keys()]).toEqual(['a.b']);
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

  it('a list that is not JSON is reported without its content', async () => {
    const html = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>secret-page') });
    const failure = await fetchTemplates('https://cdn.example/t.json', { fetch: html }).catch((e: Error) => e.message);
    expect(failure).toBe('https://cdn.example/t.json: not valid JSON');
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
