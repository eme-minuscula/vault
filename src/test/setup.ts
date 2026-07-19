import '@testing-library/jest-dom/vitest';
// Provide an in-memory IndexedDB so Dexie works under jsdom.
import 'fake-indexeddb/auto';

// jsdom doesn't implement matchMedia; stub it for the theme logic.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
