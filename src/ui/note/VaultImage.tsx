import { useMemo } from 'react';
import { useAttachment } from '../../state/notes';
import { isExternalSrc } from '../../lib/vault/attachments';

/**
 * Renders an image referenced from a note. Vault attachments are resolved to a
 * repo path, fetched via the GitHub API as base64, and shown as a data: URI
 * (which the CSP permits). External `http(s)` images are intentionally NOT
 * loaded — the CSP blocks them, so a private note can't beacon out; we show a
 * link instead. Broken/loading states are handled inline.
 */
export function VaultImage({
  src,
  alt,
  resolve,
}: {
  src?: string;
  alt?: string;
  resolve: (src: string) => string | null;
}) {
  const raw = src ?? '';
  const external = isExternalSrc(raw);
  const path = useMemo(() => (external ? null : resolve(raw)), [external, raw, resolve]);
  const { dataUri, loading, error } = useAttachment(path ?? undefined);

  if (external) {
    return (
      <a
        href={raw}
        target="_blank"
        rel="noreferrer noopener"
        className="text-sky-700 dark:text-sky-400"
      >
        {alt || 'external image'} ↗
      </a>
    );
  }

  if (dataUri) {
    return <img src={dataUri} alt={alt ?? ''} className="mx-auto h-auto max-w-full rounded-lg" />;
  }

  const label = alt || raw.split('/').pop() || 'image';
  if (loading) {
    return <Placeholder text={`Loading ${label}…`} />;
  }
  if (error || !path) {
    return <Placeholder text={`🖼 ${label}`} muted />;
  }
  return <Placeholder text={`🖼 ${label}`} muted />;
}

function Placeholder({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border border-dashed px-2 py-1 text-xs ${
        muted
          ? 'border-neutral-300 text-neutral-400 dark:border-neutral-700'
          : 'border-neutral-300 text-neutral-500 dark:border-neutral-700 dark:text-neutral-400'
      }`}
    >
      {text}
    </span>
  );
}
