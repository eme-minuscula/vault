/**
 * Registry of in-flight attachment loads.
 *
 * Lives at the `lib/` root because both sides depend on it: the loader populates
 * it (so concurrent requests for the same image share one fetch), and the cache
 * layer clears it when a database is wiped. Keeping it here avoids the cache
 * layer having to import from `lib/vault/`, which inverts the usual direction.
 *
 * Keys are `${databaseName}:${sha}` so two database instances — or a
 * wipe-and-recreate — never share entries.
 */

const loads = new Map<string, Promise<string>>();

export function flightKey(dbName: string, sha: string): string {
  return `${dbName}:${sha}`;
}

export function getInFlight(key: string): Promise<string> | undefined {
  return loads.get(key);
}

export function setInFlight(key: string, load: Promise<string>): void {
  loads.set(key, load);
}

export function endInFlight(key: string): void {
  loads.delete(key);
}

/**
 * True while this load is still considered live. A load whose key has been
 * dropped (by `clearInFlight`) must not write its result — the database it was
 * fetching for has been wiped underneath it.
 */
export function isInFlight(key: string): boolean {
  return loads.has(key);
}

/** Abandon every in-flight load for a database, so none of them writes after a wipe. */
export function clearInFlight(dbName: string): void {
  for (const key of [...loads.keys()]) {
    if (key.startsWith(`${dbName}:`)) loads.delete(key);
  }
}
