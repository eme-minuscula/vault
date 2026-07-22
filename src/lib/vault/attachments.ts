import type { VaultId } from './path';

/** Resolvable attachment shape (subset of the cache record). */
export interface ResolvableAttachment {
  path: string;
  vault: VaultId;
  filename: string; // includes extension, e.g. "diagram.png"
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)$/i;

export function isImagePath(path: string): boolean {
  return IMAGE_EXT_RE.test(path);
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
};

export function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

/** True for srcs we render directly rather than resolving as a vault attachment. */
export function isExternalSrc(src: string): boolean {
  return /^(https?:|data:|blob:)/i.test(src);
}

/**
 * Resolve an image reference to an attachment path within the same vault.
 * Handles Obsidian embeds (`diagram.png`), and relative markdown srcs
 * (`attachments/diagram.png`, `./x/diagram.png`). Matches by basename first
 * (Obsidian style), then by path suffix. Returns null if unresolved/ambiguous.
 */
export function resolveAttachmentPath(
  src: string,
  vault: VaultId,
  attachments: readonly ResolvableAttachment[],
): string | null {
  if (!src || isExternalSrc(src)) return null;
  let ref = src.trim();
  try {
    ref = decodeURIComponent(ref);
  } catch {
    /* keep raw if it isn't valid percent-encoding */
  }
  ref = ref.replace(/^\.?\//, '').replace(/[#?].*$/, ''); // drop leading ./ and any #anchor/?query
  const inVault = attachments.filter((a) => a.vault === vault);

  const base = (ref.split('/').pop() ?? ref).toLowerCase();
  const byName = inVault.filter((a) => a.filename.toLowerCase() === base);
  if (byName.length === 1) return byName[0]?.path ?? null;

  if (ref.includes('/')) {
    const suffix = ref.toLowerCase();
    const bySuffix = inVault.filter((a) => a.path.toLowerCase().endsWith(suffix));
    if (bySuffix.length === 1) return bySuffix[0]?.path ?? null;
  }

  // No match, or an ambiguous basename shared by several attachments.
  return null;
}
