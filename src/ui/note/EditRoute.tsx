import { Link, useParams } from 'react-router-dom';
import { useNote } from '../../state/notes';
import { fullText } from '../../lib/cache/db';
import { notePathname } from '../../app/routes';
import { NoteEditor } from './NoteEditor';

/** Edit an existing note by path. */
export function EditRoute() {
  const path = useParams()['*'] || '';
  const note = useNote(path);

  if (note === undefined)
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">Loading…</p>;
  if (note === null) {
    return (
      <div>
        <Link
          to="/"
          className="text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400"
        >
          ← Library
        </Link>
        <p className="mt-6 text-neutral-500">This note isn’t in the cache.</p>
      </div>
    );
  }

  return (
    <NoteEditor
      initialPath={note.path}
      initialText={fullText(note)}
      backTo={notePathname(note.path)}
    />
  );
}

/** Create a new note. */
export function NewRoute() {
  return <NoteEditor create initialPath="" initialText="" backTo="/" />;
}
