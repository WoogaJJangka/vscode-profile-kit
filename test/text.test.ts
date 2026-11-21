import { describe, expect, it } from 'vitest';

import { compareCodeUnits, folderKey, readErrorSummary, trimTrailingSlashes } from '../src/core';

describe('compareCodeUnits', () => {
  it('sorts like sort() without a compare function, whatever the locale', () => {
    const list = ['b', 'B', 'a', 'é', 'Z', '_x', '10', '9'];
    expect([...list].sort(compareCodeUnits)).toEqual([...list].sort());
    expect(compareCodeUnits('a', 'a')).toBe(0);
  });
});

describe('trimTrailingSlashes', () => {
  it.each([
    ['/d:/dev/', '/d:/dev'],
    ['/d:/dev///', '/d:/dev'],
    ['/', ''],
    ['', ''],
    ['a/b', 'a/b'],
  ])('%j → %j', (input, out) => expect(trimTrailingSlashes(input)).toBe(out));

  it('stays fast on a long run of slashes', () => {
    const s = `a${'/'.repeat(100_000)}b`;
    const started = Date.now();
    expect(trimTrailingSlashes(s)).toBe(s);
    expect(folderKey(s + '/')).toBe(s);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('readErrorSummary', () => {
  it('never quotes the text a JSON error failed on', () => {
    let error: unknown;
    try {
      JSON.parse('secret-token-123 {');
    } catch (e) {
      error = e;
    }
    expect(readErrorSummary(error)).toBe('not valid JSON');
  });

  it('file system errors give their code; other errors keep their message', () => {
    expect(readErrorSummary(Object.assign(new Error('ENOENT: no such file, open x'), { code: 'ENOENT' }))).toBe(
      'ENOENT',
    );
    expect(readErrorSummary(new Error('extensions.json is not a list'))).toBe('extensions.json is not a list');
    expect(readErrorSummary('odd')).toBe('unknown error');
  });
});
