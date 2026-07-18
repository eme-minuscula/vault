import { GitHubError, type GitHubErrorKind } from './errors';
import type {
  BlobResponse,
  BranchResponse,
  Conditional,
  ContentResponse,
  RateLimit,
  TreeResponse,
} from './types';

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

const API_BASE = 'https://api.github.com';

/**
 * Thin, dependency-free GitHub REST client scoped to a single repo.
 *
 * Design notes:
 * - The token is only ever sent as an `Authorization` header to `api.github.com`.
 *   It is never logged, never placed in a URL/query string.
 * - Reads use conditional requests (ETag) where it saves work, so polling for
 *   changes costs a cheap 304 instead of re-downloading.
 * - Blobs are addressed by their immutable git SHA, so once cached they never
 *   need re-fetching — this is what keeps steady-state sync cheap.
 */
export class GitHubClient {
  private readonly cfg: GitHubConfig;

  constructor(cfg: GitHubConfig) {
    this.cfg = cfg;
  }

  get rateLimit(): RateLimit {
    return this.lastRateLimit;
  }
  private lastRateLimit: RateLimit = { remaining: null, reset: null };

  /** Current HEAD commit + tree SHA of the branch. Supports ETag short-circuit. */
  async getBranch(etag?: string | null): Promise<Conditional<BranchResponse>> {
    return this.conditionalGet<BranchResponse>(
      `/repos/${this.cfg.owner}/${this.cfg.repo}/branches/${encodeURIComponent(this.cfg.branch)}`,
      etag,
    );
  }

  /** Full recursive tree for a tree SHA (all blob paths + their SHAs). */
  async getTree(treeSha: string): Promise<TreeResponse> {
    const res = await this.request(
      `/repos/${this.cfg.owner}/${this.cfg.repo}/git/trees/${treeSha}?recursive=1`,
    );
    return (await res.json()) as TreeResponse;
  }

  /** Decoded UTF-8 text of a blob, addressed by its immutable git SHA. */
  async getBlobText(sha: string): Promise<string> {
    const res = await this.request(`/repos/${this.cfg.owner}/${this.cfg.repo}/git/blobs/${sha}`);
    const blob = (await res.json()) as BlobResponse;
    if (blob.encoding === 'base64') return decodeBase64Utf8(blob.content);
    return blob.content;
  }

  /** File metadata + content by path (used to obtain the current SHA before a write). */
  async getContent(path: string): Promise<ContentResponse> {
    const res = await this.request(
      `/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(
        this.cfg.branch,
      )}`,
    );
    return (await res.json()) as ContentResponse;
  }

  /** Lightweight connectivity + auth check: resolves the branch, returns HEAD SHA. */
  async verify(): Promise<{ headSha: string }> {
    const { data } = await this.getBranch();
    if (!data) throw new GitHubError('unknown', 'Empty branch response');
    return { headSha: data.commit.sha };
  }

  private async conditionalGet<T>(path: string, etag?: string | null): Promise<Conditional<T>> {
    const headers: Record<string, string> = {};
    if (etag) headers['If-None-Match'] = etag;
    const res = await this.request(path, { headers });
    if (res.status === 304) {
      return { notModified: true, etag: etag ?? null, data: null };
    }
    return {
      notModified: false,
      etag: res.headers.get('etag'),
      data: (await res.json()) as T,
    };
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/vnd.github+json');
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    if (this.cfg.token) headers.set('Authorization', `Bearer ${this.cfg.token}`);

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, { ...init, headers });
    } catch {
      throw new GitHubError('network', 'Network request failed', 0, null);
    }

    this.captureRateLimit(res);

    // 304 is a success for conditional requests; let the caller handle it.
    if (res.ok || res.status === 304) return res;

    throw await this.toError(res);
  }

  private captureRateLimit(res: Response) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    this.lastRateLimit = {
      remaining: remaining === null ? null : Number(remaining),
      reset: reset === null ? null : Number(reset),
    };
  }

  private async toError(res: Response): Promise<GitHubError> {
    const remaining = this.lastRateLimit.remaining;
    const reset = this.lastRateLimit.reset;
    let kind: GitHubErrorKind = 'unknown';
    if ((res.status === 403 || res.status === 429) && remaining === 0) kind = 'rate-limit';
    else if (res.status === 401) kind = 'auth';
    else if (res.status === 403) kind = 'auth';
    else if (res.status === 404) kind = 'not-found';
    else if (res.status === 409 || res.status === 422) kind = 'conflict';

    // Read the message defensively; never include token or full response in logs.
    let message = `GitHub request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* ignore non-JSON error bodies */
    }
    return new GitHubError(kind, message, res.status, kind === 'rate-limit' ? reset : null);
  }
}

/** Decode base64 (possibly line-wrapped, as GitHub returns it) into UTF-8 text. */
export function decodeBase64Utf8(base64: string): string {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Encode UTF-8 text to base64 for writes (round-trips decodeBase64Utf8). */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Encode a repo-relative path for a URL while keeping the slashes as separators. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
