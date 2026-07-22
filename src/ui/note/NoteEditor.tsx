import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentClient } from '../../state/client';
import { db } from '../../lib/cache/db';
import { saveNoteText } from '../../lib/vault/mutations';
import { splitDoc } from '../../lib/frontmatter/doc';
import { hasExtendedSyntax } from '../../lib/markdown/wysiwyg';
import { useHoldEditorGuard } from '../../state/editorGuard';
import { notePathname } from '../../app/routes';
import { describeError } from '../errors';
import { WysiwygEditor, type WysiwygHandle } from './WysiwygEditor';

type Mode = 'wysiwyg' | 'raw';

/**
 * Note editor with two modes that toggle per note:
 * - WYSIWYG (default): Notion-style editing of the body; frontmatter preserved
 *   verbatim. May normalize markdown formatting.
 * - Raw markdown: edits the full text (frontmatter included) — fully lossless,
 *   the source of truth.
 */
export function NoteEditor({
  create = false,
  initialPath,
  initialText,
  backTo,
}: {
  create?: boolean;
  initialPath: string;
  initialText: string;
  backTo: string;
}) {
  const navigate = useNavigate();
  // Block service-worker-driven reloads while this editor is mounted.
  useHoldEditorGuard();
  const [path, setPath] = useState(initialPath);
  // Default to Visual, but open notes that use extended Obsidian syntax
  // (callouts, highlights, comments, block refs) in raw mode so a view+save
  // can't silently normalize them.
  const [mode, setMode] = useState<Mode>(() =>
    hasExtendedSyntax(splitDoc(initialText).body) ? 'raw' : 'wysiwyg',
  );
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
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
    const cleanPath = normalizePath(path);
    if (create && !isValidNotePath(cleanPath)) {
      setError('Enter a path like w/Folder/Title.md');
      return;
    }
    const full = currentFullText();
    if (!create && full === initialText) {
      // Nothing changed — skip the write (and the empty commit).
      void navigate(notePathname(cleanPath), { replace: true });
      return;
    }
    setStatus('saving');
    setError(null);
    try {
      await saveNoteText(client, db(), cleanPath, full, { create });
      // Queued-offline still updates the cache optimistically, so navigate either way
      // (the outbox flushes on reconnect).
      void navigate(notePathname(cleanPath), { replace: true });
    } catch (err) {
      setError(describeError(err));
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
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-500">Path</span>
          <input
            type="text"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="w/Folder/Title.md"
            autoCapitalize="off"
            spellCheck={false}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          />
        </label>
      )}

      {mode === 'wysiwyg' ? (
        <WysiwygEditor key={wysiwygKey} ref={wysiwygRef} defaultBody={wysiwygBody} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck
          placeholder={'---\ntype: note\n---\n\n# Title\n\nWrite here…'}
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
        {mode === 'wysiwyg'
          ? 'Visual editing of the body — formatting may be normalized on save. Frontmatter is preserved; switch to Markdown for exact control.'
          : 'Editing raw markdown, including frontmatter — exactly what gets committed.'}
      </p>
    </div>
  );
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

function normalizePath(path: string): string {
  // Drop empty and '.' segments so 'w//x' or 'w/./x' become 'w/x'.
  const clean = path
    .trim()
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .join('/');
  return /\.md$/i.test(clean) || clean === '' ? clean : `${clean}.md`;
}

function isValidNotePath(path: string): boolean {
  return /^[^/].*\.md$/i.test(path) && !path.includes('..');
}
