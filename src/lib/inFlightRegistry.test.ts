import { describe, expect, it } from 'vitest';
import {
  clearInFlight,
  endInFlight,
  flightKey,
  getInFlight,
  isInFlight,
  setInFlight,
} from './inFlightRegistry';

describe('inFlightRegistry', () => {
  it('scopes keys by database name so instances never collide', () => {
    expect(flightKey('a', 'sha')).not.toBe(flightKey('b', 'sha'));
  });

  it('registers and retrieves a load', () => {
    const key = flightKey('db1', 's1');
    const p = Promise.resolve('x');
    setInFlight(key, p);
    expect(getInFlight(key)).toBe(p);
    expect(isInFlight(key)).toBe(true);
    endInFlight(key);
    expect(isInFlight(key)).toBe(false);
  });

  it('clearInFlight abandons only the named database, and makes isInFlight false', () => {
    setInFlight(flightKey('wiped', 's1'), Promise.resolve('a'));
    setInFlight(flightKey('wiped', 's2'), Promise.resolve('b'));
    setInFlight(flightKey('other', 's1'), Promise.resolve('c'));

    clearInFlight('wiped');

    // The loader checks isInFlight before writing, so a cleared key means "skip".
    expect(isInFlight(flightKey('wiped', 's1'))).toBe(false);
    expect(isInFlight(flightKey('wiped', 's2'))).toBe(false);
    expect(isInFlight(flightKey('other', 's1'))).toBe(true);
    endInFlight(flightKey('other', 's1'));
  });
});
