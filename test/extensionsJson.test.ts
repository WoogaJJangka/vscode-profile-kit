import { describe, expect, it } from 'vitest';

import { defaultInstalledIds, parseExtensionsJson, profileInstalledIds } from '../src/core/extensionsJson';

/** An entry the way VS Code 1.147 writes it (only the parts that matter here). */
const entry = (id: string, metadata: Record<string, unknown> = {}, folder = `${id.toLowerCase()}-1.0.0`) => ({
  identifier: { id, uuid: '00000000-0000-0000-0000-000000000000' },
  version: '1.0.0',
  location: { $mid: 1, path: `/c:/x/${folder}`, scheme: 'file' },
  relativeLocation: folder,
  metadata: { installedTimestamp: 1, source: 'gallery', ...metadata },
});
const text = (...entries: unknown[]) => JSON.stringify(entries);

describe('parseExtensionsJson', () => {
  it('reads IDs in lower case with the two flags that decide where an entry counts', () => {
    expect(
      parseExtensionsJson(
        text(
          entry('MS-CEINTL.vscode-language-pack-ko', { isApplicationScoped: true }),
          entry('ms-vscode.js-debug', { isBuiltin: true }),
          entry('a.b', { isApplicationScoped: false, isBuiltin: false }),
          { identifier: { id: 'no.metadata' }, version: '1.0.0', relativeLocation: 'no.metadata-1.0.0' },
        ),
      ),
    ).toEqual([
      { id: 'ms-ceintl.vscode-language-pack-ko', applicationScoped: true, builtin: false },
      { id: 'ms-vscode.js-debug', applicationScoped: false, builtin: true },
      { id: 'a.b', applicationScoped: false, builtin: false },
      { id: 'no.metadata', applicationScoped: false, builtin: false },
    ]);
  });

  it('takes an empty file for an empty list, with or without a byte order mark', () => {
    expect(parseExtensionsJson('')).toEqual([]);
    expect(parseExtensionsJson(' \n')).toEqual([]);
    expect(parseExtensionsJson('\uFEFF[]')).toEqual([]);
  });

  it('leaves out an entry whose location is plain text, as VS Code does', () => {
    const plain = { identifier: { id: 'old.format' }, version: '1.0.0', location: 'c:\\x\\old.format-1.0.0' };
    expect(parseExtensionsJson(text(plain, entry('a.b'))).map((e) => e.id)).toEqual(['a.b']);
    // with a relative location it is an entry like any other
    expect(parseExtensionsJson(text({ ...plain, relativeLocation: 'old.format-1.0.0' })).map((e) => e.id)).toEqual([
      'old.format',
    ]);
  });

  it('throws on anything that is not a list of entries with an extension ID', () => {
    expect(() => parseExtensionsJson('{}')).toThrow(/not a list/);
    expect(() => parseExtensionsJson('{ broken')).toThrow(SyntaxError);
    for (const bad of [null, 'a.b', {}, { identifier: 'a.b' }, { identifier: { id: 7 } }, { identifier: { id: ' ' } }])
      expect(() => parseExtensionsJson(text(entry('a.b'), bad))).toThrow(/without an extension ID/);
  });
});

describe('what code --list-extensions prints, from the lists', () => {
  const defaults = parseExtensionsJson(
    text(
      entry('z.default-only'),
      entry('ms-ceintl.vscode-language-pack-ko', { isApplicationScoped: true }),
      entry('ms-vscode.js-debug', { isBuiltin: true }),
    ),
  );

  it('Default: every entry of its list, once, sorted', () => {
    expect(defaultInstalledIds(defaults)).toEqual([
      'ms-ceintl.vscode-language-pack-ko',
      'ms-vscode.js-debug',
      'z.default-only',
    ]);
    expect(defaultInstalledIds(parseExtensionsJson(text(entry('a.b'), entry('A.B', {}, 'a.b-2.0.0'))))).toEqual([
      'a.b',
    ]);
  });

  it("a profile: its own entries plus Default's that count in every profile", () => {
    const own = parseExtensionsJson(text(entry('ms-python.python'), entry('a.b')));
    expect(profileInstalledIds(own, defaults)).toEqual([
      'a.b',
      'ms-ceintl.vscode-language-pack-ko',
      'ms-python.python',
      'ms-vscode.js-debug',
    ]);
    expect(profileInstalledIds([], defaults)).toEqual(['ms-ceintl.vscode-language-pack-ko', 'ms-vscode.js-debug']);
    expect(profileInstalledIds(own, [])).toEqual(['a.b', 'ms-python.python']);
  });

  it("a profile's own entry marked as applied to all profiles only counts when Default has it", () => {
    const own = parseExtensionsJson(
      text(
        entry('a.b'),
        entry('stale.scoped', { isApplicationScoped: true }),
        entry('ms-ceintl.vscode-language-pack-ko', { isApplicationScoped: true }),
      ),
    );
    expect(profileInstalledIds(own, defaults)).toEqual([
      'a.b',
      'ms-ceintl.vscode-language-pack-ko',
      'ms-vscode.js-debug',
    ]);
  });
});
