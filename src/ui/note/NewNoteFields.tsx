import { useEffect, useId, useRef } from 'react';
import { useFolderOptions } from '../../state/notes';
import { planNewNote, titleFallback, type NewNoteTarget } from '../../lib/vault/newNote';

export interface NewNoteValue {
  target: NewNoteTarget;
  /** Folder relative to the vault root ('' = root). */
  folder: string;
  /** True while the user is typing a folder that doesn't exist yet. */
  newFolder: boolean;
  title: string;
  active: boolean;
}

const TARGETS: { id: NewNoteTarget; label: string; hint: string }[] = [
  { id: 'w', label: 'Work', hint: 'Filed in the work vault' },
  { id: 'm', label: 'Personal', hint: 'Filed in the personal vault' },
  { id: '_inbox', label: 'Quick capture', hint: 'Lands in the inbox; /drain files it later' },
];

const NEW_FOLDER = '\u0000new';

/** Destination, title and Active flag for a note being created. */
export function NewNoteFields({
  value,
  onChange,
  now,
}: {
  value: NewNoteValue;
  onChange: (next: NewNoteValue) => void;
  now: Date;
}) {
  const set = (patch: Partial<NewNoteValue>) => onChange({ ...value, ...patch });
  const titleRef = useRef<HTMLInputElement>(null);
  const folderId = useId();
  const activeId = useId();
  const inbox = value.target === '_inbox';

  useEffect(() => titleRef.current?.focus(), []);

  const vault = value.target === '_inbox' ? undefined : value.target;
  const options = useFolderOptions(vault);

  const plan = planNewNote({ ...value, now });
  const fallback = titleFallback(value.target, value.folder, now);
  const fm = plan.fields.map(([k, v]) => `${k}: ${v}`).join(', ');

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Where to save" className="flex flex-wrap gap-2">
        {TARGETS.map((t) => (
          <button
            key={t.id}
            aria-pressed={value.target === t.id}
            title={t.hint}
            onClick={() => set({ target: t.id, folder: '', newFolder: false })}
            className={
              value.target === t.id
                ? 'rounded-full bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900'
                : 'rounded-full border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:border-neutral-400 dark:border-neutral-800 dark:text-neutral-300 dark:hover:border-neutral-600'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {!inbox && (
        <div className="flex flex-col gap-1">
          <label htmlFor={folderId} className="text-xs font-medium text-neutral-500">
            Folder
          </label>
          {value.newFolder ? (
            <div className="flex gap-2">
              <input
                id={folderId}
                type="text"
                value={value.folder}
                onChange={(e) => set({ folder: e.target.value })}
                placeholder="Projects/NEW"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                className={inputClass}
              />
              <button
                onClick={() => set({ folder: '', newFolder: false })}
                className="shrink-0 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
              >
                Pick existing
              </button>
            </div>
          ) : (
            <select
              id={folderId}
              value={value.folder}
              onChange={(e) =>
                e.target.value === NEW_FOLDER
                  ? set({ folder: '', newFolder: true })
                  : set({ folder: e.target.value })
              }
              className={inputClass}
            >
              {(options ?? ['']).map((f) => (
                <option key={f} value={f}>
                  {f === '' ? '(vault root)' : f}
                </option>
              ))}
              {/* Keep the context folder selectable, even before the list loads. */}
              {value.folder !== '' && !(options ?? []).includes(value.folder) && (
                <option value={value.folder}>{value.folder}</option>
              )}
              <option value={NEW_FOLDER}>+ New folder…</option>
            </select>
          )}
        </div>
      )}

      <input
        ref={titleRef}
        type="text"
        aria-label="Title"
        value={value.title}
        onChange={(e) => set({ title: e.target.value })}
        placeholder={fallback ?? 'Title'}
        className="w-full border-0 bg-transparent p-0 text-2xl font-semibold outline-none placeholder:text-neutral-300 dark:placeholder:text-neutral-700"
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <label htmlFor={activeId} className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            id={activeId}
            type="checkbox"
            role="switch"
            checked={inbox || value.active}
            disabled={inbox}
            onChange={(e) => set({ active: e.target.checked })}
            className="peer sr-only"
          />
          <span
            aria-hidden
            className="relative h-5 w-9 rounded-full bg-neutral-300 transition-colors peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-400 peer-disabled:opacity-60 after:absolute after:top-0.5 after:left-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4 dark:bg-neutral-700"
          />
          <span>Active</span>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {inbox ? 'captures stay active until filed' : 'show in the Active list'}
          </span>
        </label>
      </div>

      <p className="text-xs break-all text-neutral-500 dark:text-neutral-400">
        {plan.path ? (
          <>
            Saves to <span className="font-mono">{plan.path}</span>
          </>
        ) : (
          plan.problem
        )}
        {fm && <> · {fm}</>}
      </p>
    </div>
  );
}

const inputClass =
  'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100';
