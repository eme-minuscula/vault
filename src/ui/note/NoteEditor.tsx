import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentClient } from '../../state/client';
import { db } from '../../lib/cache/db';
import { isPathTaken, saveNoteText } from '../../lib/vault/mutations';
import { splitDoc } from '../../lib/frontmatter/doc';
import { composeNewNoteText, planNewNote, type NewNoteTarget } from '../../lib/vault/newNote';
import { hasExtendedSyntax } from '../../lib/markdown/wysiwyg';
import { useHoldEditorGuard } from '../../state/editorGuard';
import { useFolderOptions } from '../../state/notes';
import { notePathname } from '../../app/routes';
import { describeError } from '../errors';
import { WysiwygEditor, type WysiwygHandle } from './WysiwygEditor';
import { NoteLocationFields, type NoteLocationValue } from './NoteLocationFields';

type Mode = 'wysiwyg' | 'raw';

/**
 * Note editor with two modes that toggle per note:
 * - WYSIWYG (default): Notion-style editing of the body; frontmatter preserved
 *   verbatim. May normalize markdown formatting.
 * - Raw markdown: edits the full text (frontmatter included) — fully lossless,
 *   the source of truth.
 *
 * When creating, the path and default frontmatter come from the New fields
 * (vault, folder, title, Active). In Markdown mode a frontmatter block the user
 * types replaces the generated one; the Active flag is still applied.
 */
export function NoteEditor({
  create,
  initialPath = '',
  initialText = '',
  backTo,
}: {
  /** Set to create a note; seeds where it goes (e.g. the folder being browsed). */
  create?: { target: NewNoteTarget; folder: string };
  initialPath?: string;
  initialText?: string;
  backTo: string;
}) {
  const navigate = useNavigate();
  // Block service-worker-driven reloads while this editor is mounted.
  useHoldEditorGuard();
  // One clock for the preview and the save, so the path shown is the path written.
  const now = useNow(!!create);
  const [fields, setFields] = useState<NoteLocationValue>(() => ({
    target: create?.target ?? '_inbox',
    folder: create?.folder ?? '',
    newFolder: false,
    title: '',
    active: false,
  }));
  const folders = useFolderOptions(
    create && fields.target !== '_inbox' ? fields.target : undefined,
  );
  // Default to Visual, but open notes that use extended Obsidian syntax
  // (callouts, highlights, comments, block refs) in raw mode so a view+save
  // can't silently normalize them.
  const [mode, setMode] = useState<Mode>(() =>
    hasExtendedSyntax(splitDoc(initialText).body) ? 'raw' : 'wysiwyg',
  );
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Canonical full text for raw mode. In WYSIWYG mode the frontmatter is held
  // aside and the body lives in Crepe (read on demand via the handle).
  const [text, setText] = useState(initialText);
  const frontmatterRef = useRef(splitDoc(initialText).frontmatter);
  const [wysiwygBody, setWysiwygBody] = useState(splitDoc(initialText).body);
  const [wysiwygKey, setWysiwygKey] = useState(0);
  const wysiwygRef = useRef<WysiwygHandle>(null);

  /** Reassemble the full document from whichever mode is active. */
  function currentFullText(): string {
    if (mode === 'wysiwyg') {
      return frontmatterRef.current + (wysiwygRef.current?.getMarkdown() ?? wysiwygBody);
    }
    return text;
  }

  function switchTo(next: Mode) {
    if (next === mode) return;
    if (next === 'raw') {
      setText(currentFullText());
    } else {
      const { frontmatter, body } = splitDoc(text);
      frontmatterRef.current = frontmatter;
      setWysiwygBody(body);
      setWysiwygKey((k) => k + 1); // remount Crepe with the new body
    }
    setMode(next);
  }

  async function save() {
    const client = currentClient();
    if (!client) {
      setError('Not connected. Add a token in Settings.');
      return;
    }
    if (savingRef.current) return;
    let path = initialPath;
    let full = currentFullText();
    if (create) {
      const plan = planNewNote({ ...fields, now, knownFolders: folders });
      if (!plan.path) {
        setError(plan.problem ?? 'Add a title.');
        return;
      }
      path = plan.path;
      full = composeNewNoteText(plan.fields, full);
    } else if (full === initialText) {
      // Nothing changed — skip the write (and the empty commit).
      void navigate(notePathname(path), { replace: true });
      return;
    }
    // Guard synchronously: the duplicate check below awaits, and a second tap
    // in that gap would otherwise issue a second create.
    savingRef.current = true;
    setStatus('saving');
    setError(null);
    try {
      // Case-insensitive: the vault is also checked out on macOS/Windows, where
      // 'Standup.md' and 'standup.md' would collide.
      if (create && (await isPathTaken(db(), path))) {
        setError(`${path} already exists. Pick another title.`);
        savingRef.current = false;
        setStatus('idle');
        return;
      }
      await saveNoteText(client, db(), path, full, { create: !!create });
      // Queued-offline still updates the cache optimistically, so navigate either way
      // (the outbox flushes on reconnect).
      void navigate(notePathname(path), { replace: true });
    } catch (err) {
      setError(describeError(err));
      savingRef.current = false;
      setStatus('idle');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => void navigate(backTo)}
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          <ModeToggle mode={mode} onChange={switchTo} />
          <button
            onClick={() => void save()}
            disabled={status === 'saving'}
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
          >
            {status === 'saving' ? 'Saving…' : create ? 'Create' : 'Save'}
          </button>
        </div>
      </div>

      {create && (
        <NoteLocationFields
          action="create"
          value={fields}
          onChange={setFields}
          now={now}
          folders={folders}
        />
      )}

      {mode === 'wysiwyg' ? (
        <WysiwygEditor key={wysiwygKey} ref={wysiwygRef} defaultBody={wysiwygBody} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck
          placeholder="Start writing…"
          className="min-h-[60vh] w-full resize-y rounded-lg border border-neutral-200 bg-white p-4 font-mono text-sm leading-relaxed outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:focus:border-neutral-600"
        />
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <p className="text-xs text-neutral-500 dark:text-neutral-400">
        {create
          ? 'Type and date are filled in from the folder. In Markdown mode, frontmatter you type yourself replaces them, except Active.'
          : mode === 'wysiwyg'
            ? 'Visual editing of the body — formatting may be normalized on save. Frontmatter is preserved; switch to Markdown for exact control.'
            : 'Editing raw markdown, including frontmatter — exactly what gets committed.'}
      </p>
    </div>
  );
}

/**
 * The current time, refreshed every 30 s and when the app returns to the
 * foreground, so a New screen left open (e.g. overnight in a backgrounded PWA)
 * doesn't stamp a stale date. Static when `live` is false.
 */
function useNow(live: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!live) return;
    const tick = () => setNow(new Date());
    const id = window.setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [live]);
  return now;
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex rounded-lg border border-neutral-200 p-0.5 text-xs dark:border-neutral-800">
      {(['wysiwyg', 'raw'] as Mode[]).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={
            mode === m
              ? 'rounded-md bg-neutral-900 px-2.5 py-1 font-medium text-white dark:bg-white dark:text-neutral-900'
              : 'rounded-md px-2.5 py-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
          }
        >
          {m === 'wysiwyg' ? 'Visual' : 'Markdown'}
        </button>
      ))}
    </div>
  );
}
