import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Crepe } from '@milkdown/crepe';
import { restoreVaultSyntax } from '../../lib/markdown/wysiwyg';
import { isDarkNow } from '../../state/theme';

/** Imperative handle: read the current markdown at save/toggle time. */
export interface WysiwygHandle {
  getMarkdown: () => string;
}

/**
 * Notion-style WYSIWYG editor (Milkdown Crepe), for the note *body* only —
 * frontmatter is preserved verbatim by the caller. Crepe and its styles are
 * dynamically imported so the (heavy) editor is a separate chunk, loaded only
 * when this component mounts.
 *
 * Note: WYSIWYG re-serializes markdown, so it may normalize formatting. The raw
 * editor remains the lossless source of truth; this is the documented trade-off.
 */
export const WysiwygEditor = forwardRef<
  WysiwygHandle,
  { defaultBody: string; onReady?: () => void }
>(function WysiwygEditor({ defaultBody, onReady }, ref) {
  const rootRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const defaultRef = useRef(defaultBody);
  const [error, setError] = useState<string | null>(null);

  // Fall back to the initial body if the editor hasn't finished loading, so a
  // save can never wipe content with an empty string.
  useImperativeHandle(
    ref,
    () => ({
      getMarkdown: () => {
        const md = crepeRef.current?.getMarkdown();
        return md === undefined ? defaultRef.current : restoreVaultSyntax(md);
      },
    }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let created: Crepe | null = null;

    void (async () => {
      try {
        const [{ Crepe }] = await Promise.all([
          import('@milkdown/crepe'),
          import('@milkdown/crepe/theme/common/style.css'),
          isDarkNow()
            ? import('@milkdown/crepe/theme/frame-dark.css')
            : import('@milkdown/crepe/theme/frame.css'),
        ]);
        if (cancelled || !rootRef.current) return;
        const crepe = new Crepe({
          root: rootRef.current,
          defaultValue: defaultRef.current,
          features: { [Crepe.Feature.Latex]: false },
        });
        await crepe.create();
        if (cancelled) {
          void crepe.destroy();
          return;
        }
        created = crepe;
        crepeRef.current = crepe;
        onReady?.();
      } catch {
        if (!cancelled) setError('Could not load the visual editor. Use Markdown mode.');
      }
    })();

    return () => {
      cancelled = true;
      crepeRef.current = null;
      if (created) void created.destroy();
    };
    // Mount once; the caller remounts (via key) to load a different body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
        {error}
      </p>
    );
  }

  return (
    <div
      ref={rootRef}
      className="milkdown-host min-h-[60vh] rounded-lg border border-neutral-200 bg-white dark:border-neutral-800"
    />
  );
});
