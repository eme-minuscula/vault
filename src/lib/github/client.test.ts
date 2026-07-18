import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubClient, decodeBase64Utf8, encodeBase64Utf8, encodePath } from './client';
import { GitHubError } from './errors';

const cfg = { token: 'test-token', owner: 'o', repo: 'r', branch: 'main' };

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('base64 helpers', () => {
  it('round-trips UTF-8 including accents and emoji', () => {
    const text = 'Cafè de filtre — Mònica 🍳\nsecond line';
    expect(decodeBase64Utf8(encodeBase64Utf8(text))).toBe(text);
  });

  it('decodes line-wrapped base64 as GitHub returns it', () => {
    const wrapped = encodeBase64Utf8('hello world').replace(/(.{4})/g, '$1\n');
    expect(decodeBase64Utf8(wrapped)).toBe('hello world');
  });
});

describe('encodePath', () => {
  it('encodes segments but keeps slashes', () => {
    expect(encodePath('r/People/Mònica Escudero.md')).toBe('r/People/M%C3%B2nica%20Escudero.md');
  });
});

describe('GitHubClient', () => {
  it('sends the token as an Authorization header, never in the URL', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse(
          { commit: { sha: 'abc', commit: { tree: { sha: 'tree1' } } } },
          { headers: { etag: 'W/"e1"' } },
        ),
      );
    const client = new GitHubClient(cfg);
    await client.getBranch();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain('test-token');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
  });

  it('returns data and etag for a fresh branch request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { commit: { sha: 'abc', commit: { tree: { sha: 'tree1' } } } },
        { headers: { etag: 'W/"e1"' } },
      ),
    );
    const res = await new GitHubClient(cfg).getBranch();
    expect(res.notModified).toBe(false);
    expect(res.data?.commit.sha).toBe('abc');
    expect(res.etag).toBe('W/"e1"');
  });

  it('short-circuits on 304 Not Modified', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 304 }));
    const res = await new GitHubClient(cfg).getBranch('W/"e1"');

    const headers = new Headers((fetchMock.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get('If-None-Match')).toBe('W/"e1"');
    expect(res.notModified).toBe(true);
    expect(res.data).toBeNull();
  });

  it('decodes blob content', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ sha: 's', encoding: 'base64', content: encodeBase64Utf8('# Hi'), size: 4 }),
    );
    expect(await new GitHubClient(cfg).getBlobText('s')).toBe('# Hi');
  });

  it('maps 401 to an auth error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ message: 'Bad credentials' }, { status: 401 }),
    );
    await expect(new GitHubClient(cfg).getBranch()).rejects.toMatchObject({ kind: 'auth' });
  });

  it('maps 404 to not-found', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ message: 'Not Found' }, { status: 404 }),
    );
    await expect(new GitHubClient(cfg).getBranch()).rejects.toMatchObject({ kind: 'not-found' });
  });

  it('maps 403 with zero remaining to rate-limit and captures reset', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(
        { message: 'API rate limit exceeded' },
        {
          status: 403,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1700000000' },
        },
      ),
    );
    const err = await new GitHubClient(cfg).getBranch().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).kind).toBe('rate-limit');
    expect((err as GitHubError).rateLimitReset).toBe(1700000000);
  });

  it('maps a thrown fetch to a network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('failed to fetch'));
    await expect(new GitHubClient(cfg).getBranch()).rejects.toMatchObject({ kind: 'network' });
  });
});
