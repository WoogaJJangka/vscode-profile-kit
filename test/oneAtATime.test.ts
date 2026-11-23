import { describe, expect, it } from 'vitest';

import { OneAtATime } from '../src/core';

describe('OneAtATime', () => {
  it('runs one change and refuses a second while the first runs', async () => {
    const one = new OneAtATime();
    let finish!: () => void;
    const first = one.run('applying', () => new Promise<string>((resolve) => (finish = () => resolve('done'))));
    expect(one.current).toBe('applying');

    let secondRan = false;
    const second = await one.run('installing', () => {
      secondRan = true;
      return Promise.resolve(1);
    });
    expect(second).toEqual({ ran: false, running: 'applying' });
    expect(secondRan).toBe(false);

    finish();
    expect(await first).toEqual({ ran: true, value: 'done' });
    expect(one.current).toBeUndefined();
    expect(await one.run('installing', () => Promise.resolve(2))).toEqual({ ran: true, value: 2 });
  });

  it('frees the slot when the change throws, and passes the error on', async () => {
    const one = new OneAtATime();
    await expect(one.run('applying', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(one.current).toBeUndefined();
    expect((await one.run('again', () => Promise.resolve(true))).ran).toBe(true);
  });
});
