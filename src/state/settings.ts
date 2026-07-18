import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * App settings, persisted to localStorage so the user configures the app once.
 *
 * SECURITY: the GitHub token lives here, on-device only. This is the deliberate
 * trade-off of the no-server design (see README). It is never sent anywhere but
 * `api.github.com`, never logged, and `forget()` wipes it. Users are advised to
 * use a fine-grained token scoped to just the vault repo and to install only on
 * trusted devices.
 */
export interface SettingsState {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  /** Path prefixes excluded from sync (bulky, low-value-to-search content). */
  ignoredPrefixes: string[];
  /** True once a sync has completed at least once with the current config. */
  configured: boolean;

  setToken: (token: string) => void;
  setRepo: (cfg: Partial<Pick<SettingsState, 'owner' | 'repo' | 'branch'>>) => void;
  setIgnoredPrefixes: (prefixes: string[]) => void;
  setConfigured: (configured: boolean) => void;
  /** Clear the token and mark unconfigured. Cache clearing is handled by the caller. */
  forget: () => void;
}

export const DEFAULT_OWNER = 'eme-minuscula';
export const DEFAULT_REPO = 'obsidian-vault';
export const DEFAULT_BRANCH = 'main';
// Bulky auto-synced podcast transcripts: excluded by default, editable in Settings.
export const DEFAULT_IGNORED_PREFIXES = ['w/PrOps/Knowledge/LennysPodcast/'];

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      token: '',
      owner: DEFAULT_OWNER,
      repo: DEFAULT_REPO,
      branch: DEFAULT_BRANCH,
      ignoredPrefixes: DEFAULT_IGNORED_PREFIXES,
      configured: false,

      setToken: (token) => set({ token: token.trim() }),
      setRepo: (cfg) => set(cfg),
      setIgnoredPrefixes: (ignoredPrefixes) => set({ ignoredPrefixes }),
      setConfigured: (configured) => set({ configured }),
      forget: () => set({ token: '', configured: false }),
    }),
    {
      name: 'vault-settings',
      // Persist only serializable config, not the action functions.
      partialize: (s) => ({
        token: s.token,
        owner: s.owner,
        repo: s.repo,
        branch: s.branch,
        ignoredPrefixes: s.ignoredPrefixes,
        configured: s.configured,
      }),
    },
  ),
);
