import { GitHubError } from '../lib/github/errors';
import { resetClock } from './format';

/** Human-friendly message for any error surfaced to the user. */
export function describeError(err: unknown): string {
  if (err instanceof GitHubError) {
    switch (err.kind) {
      case 'auth':
        return 'Your token was rejected. Check it still has write access.';
      case 'not-found':
        return 'Not found on GitHub. It may have moved or been deleted.';
      case 'rate-limit':
        return err.rateLimitReset
          ? `GitHub rate limit reached. Try again after ${resetClock(err.rateLimitReset)}.`
          : 'GitHub rate limit reached. Try again shortly.';
      case 'conflict':
        return 'This note changed on GitHub since you opened it. Sync and try again.';
      case 'network':
        return 'Offline — your change is queued and will sync when you reconnect.';
      default:
        return err.message || 'Something went wrong.';
    }
  }
  return err instanceof Error ? err.message : 'Something went wrong.';
}
