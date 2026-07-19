/** Shapes of the GitHub REST responses we consume, narrowed to the fields we use. */

export interface BranchResponse {
  commit: {
    sha: string;
    commit: {
      tree: { sha: string };
    };
  };
}

export interface TreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
}

export interface TreeResponse {
  sha: string;
  tree: TreeEntry[];
  truncated: boolean;
}

export interface BlobResponse {
  sha: string;
  content: string;
  encoding: 'base64' | 'utf-8';
  size: number;
}

export interface ContentResponse {
  path: string;
  sha: string;
  content: string;
  encoding: string;
}

export interface WriteResponse {
  content: { sha: string; path: string } | null;
  commit: { sha: string };
}

/** Result of a conditional GET: `notModified` short-circuits on a 304. */
export interface Conditional<T> {
  notModified: boolean;
  etag: string | null;
  data: T | null;
}

export interface RateLimit {
  remaining: number | null;
  reset: number | null;
}
