import { describe, expect, it } from 'vitest';
import { mapLimit } from './mapLimit';

describe('mapLimit', () => {
  it('preserves order and maps all items', async () => {
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency limit', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapLimit(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async (n) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return n;
      },
    );
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it('rejects if a worker throws', async () => {
    await expect(
      mapLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('handles an empty input', async () => {
    expect(await mapLimit([], 4, async (n) => n)).toEqual([]);
  });
});
