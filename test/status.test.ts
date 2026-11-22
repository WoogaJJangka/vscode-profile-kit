import { describe, expect, it } from 'vitest';

import { declaredCount, needsChanges, presetStatus } from '../src/core';

describe('presetStatus', () => {
  const status = presetStatus([
    { name: 'Core', declared: true, exists: true, missing: 0 },
    { name: 'Python', declared: true, exists: true, missing: 2 },
    { name: 'Web', declared: true, exists: false },
    { name: 'Java', declared: true, exists: true },
    { name: 'Old', declared: false, exists: true, missing: 5 },
  ]);

  it('sorts declared profiles by state and leaves the others out', () => {
    expect(status).toEqual({ notCreated: ['Web'], missing: ['Python'], checking: ['Java'], ok: ['Core'] });
    expect(declaredCount(status)).toBe(4);
  });

  it('profiles to create or install into need changes; ones not listed yet do not count', () => {
    expect(needsChanges(status)).toEqual(['Web', 'Python']);
  });

  it('nothing declared: nothing to do', () => {
    const empty = presetStatus([{ name: 'Mine', declared: false, exists: true }]);
    expect(declaredCount(empty)).toBe(0);
    expect(needsChanges(empty)).toEqual([]);
  });
});
