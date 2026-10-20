/**
 * Building a brand-new note: where it goes and what frontmatter it starts with.
 *
 * The folder → frontmatter table mirrors the schema in each vault's `CLAUDE.md`
 * (obsidian-vault repo: `w/CLAUDE.md`, `m/CLAUDE.md`). It is deliberately small —
 * only `type:` and `date:` are filled in automatically; everything else (tags,
 * author) is left for the user or Claude. If the vault layout changes, update
 * FOLDER_RULES; a folder with no rule simply gets no `type:`.
 */

import { setActiveFlag, splitDoc } from '../frontmatter/doc';
import { isExcludedPath } from './path';

/** Where the New screen can write: the two vaults, or the capture inbox. */
export type NewNoteTarget = 'w' | 'm' | '_inbox';

interface FolderRule {
  vault: 'w' | 'm';
  /** Folder relative to the vault root. Subfolders inherit the rule. */
  folder: string;
  type: string;
  /** Stamp today's date (`date: 'YYYY-MM-DD'`). */
  date?: boolean;
}

export const FOLDER_RULES: readonly FolderRule[] = [
  { vault: 'w', folder: 'Learning', type: 'learning' },
  { vault: 'w', folder: 'People', type: 'person' },
  { vault: 'm', folder: 'Books', type: 'book' },
  { vault: 'm', folder: 'People', type: 'person' },
  { vault: 'm', folder: 'Travel/Logs', type: 'trip-log', date: true },
  { vault: 'm', folder: 'Travel/Plans', type: 'trip-plan' },
  { vault: 'm', folder: 'Journaling', type: 'journal', date: true },
  { vault: 'm', folder: 'DailyNotes', type: 'daily' },
];

/** Daily notes are named by date, so an empty title falls back to today. */
const DATE_NAMED_FOLDERS: readonly string[] = ['m/DailyNotes'];

/**
 * Folders a new note must not be written to: the derived wiki (`k/`, maintained
 * by Claude) and attachment folders. `folder` is relative to the vault root.
 */
export function isWritableFolder(folder: string): boolean {
  const segs = folder.split('/');
  return segs[0] !== 'k' && !segs.includes('attachments');
}

/** Most specific rule for a vault-relative folder, if any. */
export function ruleFor(vault: NewNoteTarget, folder: string): FolderRule | undefined {
  if (vault === '_inbox') return undefined;
  return FOLDER_RULES.filter(
    (r) => r.vault === vault && (folder === r.folder || folder.startsWith(`${r.folder}/`)),
  ).sort((a, b) => b.folder.length - a.folder.length)[0];
}

/**
 * Folder choices for a vault, relative to its root ('' = the root itself):
 * every folder that holds a cached note (plus its ancestors), plus the schema's
 * folders so they're offered even before they hold anything.
 */
export function folderOptions(vault: 'w' | 'm', noteFolders: Iterable<string>): string[] {
  const out = new Set<string>(['']);
  const add = (rel: string) => {
    const segs = rel.split('/').filter(Boolean);
    for (let i = 1; i <= segs.length; i++) out.add(segs.slice(0, i).join('/'));
  };
  for (const f of noteFolders) {
    if (f === vault) continue;
    if (f.startsWith(`${vault}/`)) add(f.slice(vault.length + 1));
  }
  for (const r of FOLDER_RULES) if (r.vault === vault) add(r.folder);
  return [...out].filter(isWritableFolder).sort((a, b) => a.localeCompare(b));
}

/**
 * Turn a typed title into a safe filename stem: drops characters that are
 * illegal in filenames or break Obsidian wikilinks (`/ \ : * ? " < > | # ^ [ ]`),
 * collapses whitespace and strips leading dots.
 */
export function titleToFilename(title: string): string {
  return (
    title
      .replace(/[/\\:*?"<>|#^[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      // Dots and spaces together, so '. .obsidian' can't become a dot-folder.
      .replace(/^[\s.]+/, '')
      .trim()
  );
}

/** Clean a typed folder path: each segment sanitised like a title, empties dropped. */
export function cleanFolder(folder: string): string {
  return folder
    .split('/')
    .map(titleToFilename)
    .filter((s) => s !== '' && s !== '..')
    .join('/');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local calendar date as `YYYY-MM-DD`. */
export function isoDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Inbox filename stamp, matching vault-keep: `YYYY-MM-DD-HHmm-ss`. */
export function inboxStamp(now: Date): string {
  return `${isoDate(now)}-${pad(now.getHours())}${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

export interface NewNoteInput {
  target: NewNoteTarget;
  /** Folder relative to the vault root; ignored for the inbox. */
  folder: string;
  title: string;
  active: boolean;
  now: Date;
}

export interface NewNotePlan {
  /** Repo-relative path, or null when the note can't be created (see `problem`). */
  path: string | null;
  /** Why `path` is null, phrased for the user. */
  problem?: string;
  /** Frontmatter fields that will be written, in order. */
  fields: [string, string][];
}

/** Resolve the path and frontmatter for a new note, without writing anything. */
export function planNewNote(input: NewNoteInput): NewNotePlan {
  const { target, now } = input;
  const folder = target === '_inbox' ? '' : cleanFolder(input.folder);
  const dir = folder ? `${target}/${folder}` : target;

  let stem = titleToFilename(input.title);
  if (!stem && target === '_inbox') stem = inboxStamp(now);
  if (!stem && DATE_NAMED_FOLDERS.includes(dir)) stem = isoDate(now);

  const fields: [string, string][] = [];
  const rule = ruleFor(target, folder);
  if (rule) fields.push(['type', rule.type]);
  if (rule?.date) fields.push(['date', `'${isoDate(now)}'`]);
  // Inbox captures are always active: that's how they surface until filed.
  if (input.active || target === '_inbox') fields.push(['active', 'true']);

  if (!isWritableFolder(folder)) {
    return { path: null, problem: 'That folder is reserved (wiki or attachments).', fields };
  }
  if (!stem) return { path: null, problem: 'Add a title.', fields };
  const path = `${dir}/${stem}.md`;
  // Dot-folders and Creds.md are never synced or shown; a note there would vanish.
  if (isExcludedPath(path)) return { path: null, problem: 'That name isn’t allowed.', fields };
  return { path, fields };
}

/**
 * The full text to commit for a new note. The generated frontmatter is
 * prepended, unless the user typed their own block in Markdown mode: theirs
 * wins, but an inbox capture is still forced active.
 */
export function composeNewNoteText(fields: [string, string][], text: string): string {
  if (splitDoc(text).frontmatter) {
    return fields.some(([k]) => k === 'active') ? setActiveFlag(text, true) : text;
  }
  return fields.length > 0 ? `${frontmatterBlock(fields)}\n${text}` : text;
}

/**
 * Where the New screen starts, from a repo folder (`?in=`): its vault and
 * folder. Without a known vault it starts on Quick capture, so a note is never
 * silently filed into the wrong vault — the inbox is unclassified by design.
 */
export function newNoteContext(dir: string): { target: NewNoteTarget; folder: string } {
  const [top = '', ...rest] = dir.split('/');
  if (top === 'w' || top === 'm') {
    const folder = rest.join('/');
    return { target: top, folder: isWritableFolder(folder) ? folder : '' };
  }
  return { target: '_inbox', folder: '' };
}

/**
 * Link for the New button, opened in the context being browsed: a vault view
 * passes that vault, a note view the note's folder. `pathname` is the router
 * pathname, still percent-encoded.
 */
export function newNoteHref(pathname: string): string {
  const vault = /^\/v\/(w|m|_inbox)$/.exec(pathname)?.[1];
  if (vault) return `/new?in=${encodeURIComponent(vault)}`;
  const note = /^\/note\/(.+)$/.exec(pathname)?.[1];
  if (!note) return '/new';
  let path: string;
  try {
    path = decodeURIComponent(note);
  } catch {
    return '/new'; // malformed escape in a hand-typed link
  }
  const dir = path.split('/').slice(0, -1).join('/');
  return dir ? `/new?in=${encodeURIComponent(dir)}` : '/new';
}

/** The frontmatter block for a plan's fields, or '' when there are none. */
export function frontmatterBlock(fields: [string, string][]): string {
  if (fields.length === 0) return '';
  return `---\n${fields.map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
}

/** The placeholder title to show: what an empty title will fall back to. */
export function titleFallback(target: NewNoteTarget, folder: string, now: Date): string | null {
  if (target === '_inbox') return inboxStamp(now);
  const dir = folder ? `${target}/${cleanFolder(folder)}` : target;
  return DATE_NAMED_FOLDERS.includes(dir) ? isoDate(now) : null;
}
