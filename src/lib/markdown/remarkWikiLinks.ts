import { noteHref, MISSING_HREF } from '../../app/routes';
import { parseWikiTarget } from '../vault/links';

/**
 * Remark plugin that turns `[[wikilinks]]` into real link nodes, operating on
 * the parsed tree so it never touches text inside code spans or fenced blocks.
 *
 * - Resolved link  → internal hash link (`#/note/<path>`), navigable in-app.
 * - Unresolved     → link to `#missing`, rendered as a distinct "broken" style.
 * - Image embed    → an inline-code placeholder (attachment rendering lands later).
 * - Note embed     → treated as an ordinary internal link.
 *
 * `resolve` maps a bare target (already stripped of `#heading`/`|label`) to a
 * repo path, or null when it can't be resolved within the current vault.
 */

interface MdNode {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  title?: string | null;
  children?: MdNode[];
}

const WIKILINK_RE = /(!?)\[\[([^\]\n]+?)\]\]/g;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

export type WikiResolver = (target: string) => string | null;

export function remarkWikiLinks(resolve: WikiResolver) {
  return () => (tree: MdNode) => {
    walk(tree, false, resolve);
  };
}

function walk(node: MdNode, insideLink: boolean, resolve: WikiResolver): void {
  if (!node.children) return;
  const next: MdNode[] = [];
  for (const child of node.children) {
    if (child.type === 'text' && !insideLink && child.value?.includes('[[')) {
      next.push(...splitText(child.value, resolve));
      continue;
    }
    walk(child, insideLink || child.type === 'link', resolve);
    next.push(child);
  }
  node.children = next;
}

function splitText(value: string, resolve: WikiResolver): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const m of value.matchAll(WIKILINK_RE)) {
    const start = m.index;
    if (start > last) out.push({ type: 'text', value: value.slice(last, start) });
    out.push(toNode(m[1] === '!', m[2] ?? '', resolve));
    last = start + m[0].length;
  }
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function toNode(embed: boolean, inner: string, resolve: WikiResolver): MdNode {
  const link = parseWikiTarget(inner, embed);
  const text = link.label ?? link.target;

  if (embed && IMAGE_EXT_RE.test(link.target)) {
    // Image embed → an image node; the renderer resolves it to a vault attachment.
    return { type: 'image', url: link.target, alt: link.label ?? link.target, title: null };
  }

  const resolved = resolve(link.target);
  const url = resolved ? noteHref(resolved) : MISSING_HREF;
  return { type: 'link', url, title: null, children: [{ type: 'text', value: text }] };
}
