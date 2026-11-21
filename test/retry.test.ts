import { describe, expect, it } from 'vitest';

import { backoffDelay, mapLimit, retry } from '../src/core/retry';

describe('backoffDelay', () => {
  it('doubles up to the cap', () => {
    expect([1, 2, 3, 4, 5].map((a) => backoffDelay(a, 1000, 5000))).toEqual([1000, 2000, 4000, 5000, 5000]);
  });
});

describe('retry', () => {
  it('returns the first success and waits between tries', async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await retry(
      async () => {
        calls++;
        if (calls < 3) throw new Error(`fail ${calls}`);
        return 'ok';
      },
      { attempts: 5, baseDelayMs: 100, sleep: async (ms) => void waits.push(ms) },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it('rethrows the last error when attempts run out', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          throw new Error(`fail ${++calls}`);
        },
        { attempts: 3, baseDelayMs: 1, sleep: async () => {} },
      ),
    ).rejects.toThrow('fail 3');
  });

  it('stops early when shouldRetry says no', async () => {
    let calls = 0;
    await expect(
      retry(
        async () => {
          calls++;
          throw new Error('permanent');
        },
        { attempts: 5, baseDelayMs: 1, shouldRetry: () => false, sleep: async () => {} },
      ),
    ).rejects.toThrow('permanent');
    expect(calls).toBe(1);
  });
});

describe('mapLimit', () => {
  it('keeps the order and never runs more than the limit at once', async () => {
    let running = 0;
    let most = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++;
      most = Math.max(most, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(most).toBe(2);
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });
});
