/**
 * Byte-lossless note document model.
 *
 * The editing contract is: whatever we don't deliberately change must come back
 * byte-for-byte. So we split a note into its verbatim frontmatter block (fences
 * included) and the verbatim body, and only ever splice known fields. Raw-mode
 * body edits and frontmatter toggles are fully lossless; only WYSIWYG body edits
 * (which re-serialize markdown) may reformat, and even then the frontmatter is
 * preserved exactly.
 */

export interface SplitDoc {
  /** The frontmatter block, fences and trailing newline included, or '' if none. */
  frontmatter: string;
  /** Everything after the frontmatter block. */
  body: string;
}

// The whole frontmatter region: opening fence, contents, closing fence, and the
// newline after it (if any). Captured verbatim so split→join is the identity.
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

export function splitDoc(raw: string): SplitDoc {
  const m = FRONTMATTER_BLOCK.exec(raw);
  if (!m) return { frontmatter: '', body: raw };
  return { frontmatter: m[0], body: raw.slice(m[0].length) };
}

export function joinDoc(frontmatter: string, body: string): string {
  return frontmatter + body;
}

/** Replace a note's body, preserving its frontmatter block exactly. */
export function replaceBody(raw: string, newBody: string): string {
  return joinDoc(splitDoc(raw).frontmatter, newBody);
}

/**
 * Set (or clear) the `active` flag, touching only that field and preserving the
 * rest of the document verbatim. Detects the document's newline style.
 */
export function setActiveFlag(raw: string, active: boolean): string {
  const { frontmatter, body } = splitDoc(raw);

  if (frontmatter === '') {
    // No frontmatter. Only add a block if we're turning the flag on.
    if (!active) return raw;
    return `---\nactive: true\n---\n${raw}`;
  }

  const eol = frontmatter.includes('\r\n') ? '\r\n' : '\n';
  const lines = frontmatter.split(/\r?\n/);
  const idx = lines.findIndex((l) => /^active\s*:/.test(l));

  if (idx !== -1) {
    lines[idx] = `active: ${active}`;
  } else if (active) {
    // Insert right after the opening `---` fence.
    lines.splice(1, 0, 'active: true');
  } else {
    return raw; // clearing an absent flag is a no-op
  }

  return joinDoc(lines.join(eol), body);
}
