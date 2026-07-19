import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { currentClient } from '../../state/client';
import { db } from '../../lib/cache/db';
import { saveNoteText } from '../../lib/vault/mutations';
import { notePathname } from '../../app/routes';
import { describeError } from '../errors';

/**
 * Raw markdown editor. Edits the full note text (frontmatter included) so what
 * you see is exactly what gets committed — fully lossless. A WYSIWYG mode layers
 * on top of this in a follow-up; this raw view stays the source of truth.
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
  const [path, setPath] = useState(initialPath);
  const [text, setText] = useState(initialText);
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [error, setError] = useState<string | null>(null);

  const dirty = text !== initialText || (create && path !== initialPath);

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
    setStatus('saving');
    setError(null);
    try {
      await saveNoteText(client, db(), cleanPath, text, { create });
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
          className="text-sm text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
        >
          Cancel
        </button>
        <button
          onClick={() => void save()}
          disabled={status === 'saving' || !dirty}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {status === 'saving' ? 'Saving…' : create ? 'Create' : 'Save'}
        </button>
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

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck
        placeholder={'---\ntype: note\n---\n\n# Title\n\nWrite here…'}
        className="min-h-[60vh] w-full resize-y rounded-lg border border-neutral-200 bg-white p-4 font-mono text-sm leading-relaxed outline-none focus:border-neutral-400 dark:border-neutral-800 dark:bg-neutral-950 dark:focus:border-neutral-600"
      />

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <p className="text-xs text-neutral-400">
        Editing raw markdown, including frontmatter. Saved as a commit to your vault.
      </p>
    </div>
  );
}

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '');
  return /\.md$/i.test(trimmed) || trimmed === '' ? trimmed : `${trimmed}.md`;
}

function isValidNotePath(path: string): boolean {
  return /^[^/].*\.md$/i.test(path) && !path.includes('..');
}
