import { describe, expect, it } from 'vitest';

import { diffExtensions } from '../src/core/diff';

describe('diffExtensions', () => {
  it('splits into missing / extra / present, ignoring case and versions', () => {
    const diff = diffExtensions(['a.one', 'B.Two', 'c.three'], ['b.two@1.0.0', 'A.ONE', 'z.dep', 'y.dep']);
    expect(diff).toEqual({ missing: ['c.three'], extra: ['y.dep', 'z.dep'], present: ['a.one', 'b.two'] });
  });

  it('handles empty lists', () => {
    expect(diffExtensions([], [])).toEqual({ missing: [], extra: [], present: [] });
  });
});
