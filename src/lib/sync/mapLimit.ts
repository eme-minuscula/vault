/**
 * Run `worker` over `items` with at most `limit` in flight at once.
 * Preserves input order in the returned results. Fails fast: if any worker
 * rejects, the returned promise rejects (remaining unstarted work is skipped).
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i] as T, i);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  });

  await Promise.all(runners);
  return results;
}
