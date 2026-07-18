/** Typed errors so the UI can react to auth / rate-limit / conflict distinctly. */
export type GitHubErrorKind =
  | 'auth' // 401/403 without rate-limit signal — bad or missing token
  | 'not-found' // 404 — repo/branch/path wrong, or token lacks access
  | 'rate-limit' // 403/429 with remaining=0
  | 'conflict' // 409 / 422 — stale SHA on write
  | 'network' // fetch threw (offline, DNS, CORS)
  | 'unknown';

export class GitHubError extends Error {
  readonly kind: GitHubErrorKind;
  readonly status: number;
  /** Unix seconds when the rate limit resets, if known. */
  readonly rateLimitReset: number | null;

  constructor(
    kind: GitHubErrorKind,
    message: string,
    status = 0,
    rateLimitReset: number | null = null,
  ) {
    super(message);
    this.name = 'GitHubError';
    this.kind = kind;
    this.status = status;
    this.rateLimitReset = rateLimitReset;
  }
}
