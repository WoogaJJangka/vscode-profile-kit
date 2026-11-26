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
  readInstalledExtensions,
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

  describe('installed extensions of a profile, from the lists VS Code keeps', () => {
    const entry = (id: string, metadata: Record<string, unknown> = {}) => ({
      identifier: { id },
      version: '1.0.0',
      location: { $mid: 1, path: `/x/${id}-1.0.0`, scheme: 'file' },
      relativeLocation: `${id}-1.0.0`,
      metadata,
    });
    const own = { location: '-1a2b3c4d', useDefaultFlags: {} };
    let extDir: string;
    let paths: ReturnType<typeof userDataPaths>;
    const writeDefaults = (...entries: unknown[]) =>
      writeFileSync(path.join(extDir, 'extensions.json'), JSON.stringify(entries));
    const writeOwn = (text: string, location = own.location) => {
      mkdirSync(path.dirname(paths.profileExtensions(location)), { recursive: true });
      writeFileSync(paths.profileExtensions(location), text);
    };
    beforeEach(() => {
      extDir = path.join(dir, 'x');
      mkdirSync(extDir);
      paths = userDataPaths(path.join(dir, 'u'));
    });

    it("a profile's own list plus what Default applies to all profiles", () => {
      writeDefaults(entry('z.default-only'), entry('MS-CEINTL.vscode-language-pack-ko', { isApplicationScoped: true }));
      writeOwn(JSON.stringify([entry('ms-python.python'), entry('A.B')]));
      expect(readInstalledExtensions(paths, extDir, own)).toEqual({
        ids: ['a.b', 'ms-ceintl.vscode-language-pack-ko', 'ms-python.python'],
      });
    });

    it('a profile without a list yet has no extensions of its own', () => {
      writeDefaults(entry('z.default-only'), entry('a.scoped', { isApplicationScoped: true }));
      // no User/profiles folder at all, then the profile's folder without the file
      expect(readInstalledExtensions(paths, extDir, own)).toEqual({ ids: ['a.scoped'] });
      mkdirSync(path.dirname(paths.profileExtensions(own.location)), { recursive: true });
      expect(readInstalledExtensions(paths, extDir, own)).toEqual({ ids: ['a.scoped'] });
      // and without Default's list nothing is applied to all profiles
      rmSync(path.join(extDir, 'extensions.json'));
      expect(readInstalledExtensions(paths, extDir, own)).toEqual({ ids: [] });
    });

    it("Default, and a profile that uses Default's extensions: the extensions folder's list", () => {
      writeDefaults(entry('z.default-only'), entry('a.scoped', { isApplicationScoped: true }));
      const shared = { location: '-5e6f7a8b', useDefaultFlags: { extensions: true, settings: true } };
      // a list of its own, if one is there, is not what VS Code uses for such a profile
      writeOwn(JSON.stringify([entry('left.over')]), shared.location);
      expect(readInstalledExtensions(paths, extDir)).toEqual({ ids: ['a.scoped', 'z.default-only'] });
      expect(readInstalledExtensions(paths, extDir, shared)).toEqual({ ids: ['a.scoped', 'z.default-only'] });
      // only the extensions flag decides
      const settingsOnly = { location: shared.location, useDefaultFlags: { settings: true } };
      expect(readInstalledExtensions(paths, extDir, settingsOnly)).toEqual({ ids: ['a.scoped', 'left.over'] });
    });

    it('says why when the files do not tell, without quoting them', () => {
      // Default's list is where VS Code writes it at its first start: without it Default is not known
      expect(readInstalledExtensions(paths, extDir).problem).toMatch(/extensions folder is not there/);
      writeDefaults(entry('a.b'));
      writeOwn('secret-token-123 { broken');
      const broken = readInstalledExtensions(paths, extDir, own);
      expect(broken.ids).toBeUndefined();
      expect(broken.problem).toMatch(/of the profile could not be read \(not valid JSON\)/);
      expect(broken.problem).not.toContain('secret-token');
      // a format Profile Kit does not know: not taken for a list
      writeOwn(JSON.stringify({ extensions: [entry('a.b')] }));
      expect(readInstalledExtensions(paths, extDir, own).problem).toMatch(/not a list/);
      writeOwn(JSON.stringify([{ id: 'a.b' }]));
      expect(readInstalledExtensions(paths, extDir, own).problem).toMatch(/without an extension ID/);
      // a broken list of Default: neither Default nor what it applies to all profiles is known
      writeOwn('[]');
      writeFileSync(path.join(extDir, 'extensions.json'), '{ broken');
      expect(readInstalledExtensions(paths, extDir, own).problem).toMatch(/extensions folder could not be read/);
      expect(readInstalledExtensions(paths, extDir).problem).toMatch(/extensions folder could not be read/);
      // a location that would leave User/profiles is refused before any file is touched
      writeDefaults();
      expect(readInstalledExtensions(paths, extDir, { location: '..', useDefaultFlags: {} }).problem).toMatch(
        /unexpected profile location/,
      );
    });

    it("a profile's list linked from outside User/profiles is not read", () => {
      writeDefaults();
      const outside = path.join(dir, 'outside.json');
      writeFileSync(outside, JSON.stringify([entry('x.y')]));
      mkdirSync(path.dirname(paths.profileExtensions(own.location)), { recursive: true });
      try {
        symlinkSync(outside, paths.profileExtensions(own.location), 'file');
      } catch {
        return; // no symlink rights
      }
      expect(readInstalledExtensions(paths, extDir, own).problem).toMatch(/points outside/);
    });
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

  it('reads the list and each template; a template that did not download says so', async () => {
    const got = await fetchTemplates('https://cdn.example/t.json', { fetch: fakeFetch });
    expect(got.map((t) => t.name)).toEqual(['Python', 'Gone']);
    expect(got[0].profile?.extensions).toEqual(['ms-python.python']);
    expect(got[0].failure).toBeUndefined();
    expect(got[1].failure).toEqual({ stage: 'download', reason: 'answered 404' });
  });

  it('throws when the list itself fails', async () => {
    await expect(fetchTemplates('https://cdn.example/none.json', { fetch: fakeFetch })).rejects.toThrow(/404/);
  });

  it('a downloaded template that is not a profile is a read failure, without its content', async () => {
    const withBad = (url: string) =>
      url.endsWith('gone.code-profile')
        ? Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<html>secret-page') })
        : fakeFetch(url);
    const got = await fetchTemplates('https://cdn.example/t.json', { fetch: withBad });
    expect(got[1].failure).toEqual({ stage: 'read', reason: 'not valid JSON' });
    expect(JSON.stringify(got)).not.toContain('secret-page');
  });

  it('a network error is a download failure that does not keep the error text', async () => {
    const offline = (url: string) =>
      url.endsWith('python.code-profile')
        ? Promise.reject(new Error('getaddrinfo ENOTFOUND secret-host'))
        : fakeFetch(url);
    const got = await fetchTemplates('https://cdn.example/t.json', { fetch: offline });
    expect(got[0].failure).toEqual({ stage: 'download', reason: 'could not be reached' });
    expect(JSON.stringify(got)).not.toContain('secret-host');
  });

  it('a download that takes too long is a time-out', async () => {
    const hangs = (url: string, init: { signal?: AbortSignal }) =>
      url.endsWith('python.code-profile')
        ? new Promise<never>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
        : fakeFetch(url);
    const got = await fetchTemplates('https://cdn.example/t.json', { fetch: hangs, timeoutMs: 20 });
    expect(got[0].failure).toEqual({ stage: 'download', reason: 'timed out after 0.02s' });
  });

  it('downloadAttempts tries a failed download again', async () => {
    const calls: string[] = [];
    let first = true;
    const flaky = (url: string) => {
      calls.push(url);
      if (url.endsWith('python.code-profile') && first) {
        first = false;
        return Promise.resolve({ ok: false, status: 503, text: () => Promise.resolve('') });
      }
      return fakeFetch(url);
    };
    const once = await fetchTemplates('https://cdn.example/t.json', { fetch: flaky, retryDelayMs: 0 });
    expect(once[0].failure).toEqual({ stage: 'download', reason: 'answered 503' });
    first = true;
    calls.length = 0;
    const twice = await fetchTemplates('https://cdn.example/t.json', {
      fetch: flaky,
      downloadAttempts: 2,
      retryDelayMs: 0,
    });
    expect(twice[0].profile?.extensions).toEqual(['ms-python.python']);
    expect(calls.filter((u) => u.endsWith('python.code-profile'))).toHaveLength(2);
    // still failing after the last try: reported as before
    expect(twice[1].failure).toEqual({ stage: 'download', reason: 'answered 404' });
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
