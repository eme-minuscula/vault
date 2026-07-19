import { GitHubClient } from '../lib/github/client';
import { useSettings } from './settings';

/** Build a GitHub client from the current settings, or null if not connected. */
export function currentClient(): GitHubClient | null {
  const { token, owner, repo, branch } = useSettings.getState();
  if (!token) return null;
  return new GitHubClient({ token, owner, repo, branch });
}
