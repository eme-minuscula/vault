import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useNote, useVaultNotes, useVaultAttachments } from '../../state/notes';
import { stripLeadingH1 } from '../../lib/frontmatter/parse';
import { buildWikiResolver, findBacklinks, toResolvable } from '../../lib/vault/links';
import { resolveAttachmentPath } from '../../lib/vault/attachments';
import { VAULT_LABELS } from '../../lib/vault/path';
import { vaultHref } from '../../app/routes';
import { Markdown } from './Markdown';
import { Backlinks } from './Backlinks';
import { NoteActions } from './NoteActions';

/** Read a single note: metadata, rendered body, and backlinks. */
export function NoteView() {
  const params = useParams();
  const path = params['*'] || '';
  const note = useNote(path);
  const vaultNotes = useVaultNotes(note?.vault);

  const resolvable = useMemo(() => toResolvable(vaultNotes ?? []), [vaultNotes]);
  // Built once per note-set, then reused for every wikilink in the body.
  const resolver = useMemo(() => buildWikiResolver(resolvable), [resolvable]);

  const resolve = useMemo(() => {
    const vault = note?.vault;
    return (target: string) => (vault ? resolver.resolve(target, vault) : null);
  }, [note?.vault, resolver]);

  const attachments = useVaultAttachments(note?.vault);
  const resolveAttachment = useMemo(() => {
    const vault = note?.vault;
    return (src: string) => (vault ? resolveAttachmentPath(src, vault, attachments ?? []) : null);
  }, [note?.vault, attachments]);

  const backlinks = useMemo(() => {
    if (!note) return [];
    return findBacklinks(note.path, note.vault, resolvable);
  }, [note, resolvable]);

  if (note === undefined) {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>;
  }
  if (note === null) {
    return (
      <div>
        <Link
          to="/"
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
        >
          ← Library
        </Link>
        <p className="mt-6 text-neutral-500">
          This note isn’t in the local cache. Try syncing from Settings.
        </p>
      </div>
    );
  }

  return (
    <article>
      <Link
        to={vaultHref(note.vault).slice(1)}
        className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
      >
        ← {VAULT_LABELS[note.vault]}
      </Link>

      <h1 className="mt-2 text-3xl font-semibold text-balance">{note.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {note.type && (
          <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {note.type}
          </span>
        )}
        {note.date && <span className="text-neutral-500 dark:text-neutral-400">{note.date}</span>}
        {note.active && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            active
          </span>
        )}
        {note.tags.map((t) => (
          <span key={t} className="text-neutral-500 dark:text-neutral-400">
            #{t}
          </span>
        ))}
      </div>

      <NoteActions note={note} />

      <div className="mt-6">
        <Markdown
          body={stripLeadingH1(note.body)}
          resolve={resolve}
          resolveAttachment={resolveAttachment}
        />
      </div>

      <Backlinks paths={backlinks} />
    </article>
  );
}
