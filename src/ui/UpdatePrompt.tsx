import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { useEditorOpen } from '../state/editorGuard';
import { usePendingCount } from '../state/notes';

/** How often a long-lived tab asks the browser to look for a new deploy. */
const UPDATE_CHECK_MS = 30 * 60_000;

/**
 * Keeps the app converging on the latest deploy without ever losing work.
 *
 * The worker is registered in 'prompt' mode so nothing reloads on its own — an
 * unconditional reload would discard an in-progress note (editor state is in
 * memory, there is no autosave). Instead we apply a waiting update ourselves the
 * moment it is *safe*: no editor mounted and no queued offline writes. If it
 * isn't safe yet, the toast offers a manual refresh and the update is applied
 * automatically as soon as the user leaves the editor / the outbox drains.
 */
export function UpdatePrompt() {
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      setRegistration(reg ?? null);
    },
  });

  // Poll periodically, and whenever the tab comes back to the foreground — the
  // trigger that actually matters on a phone.
  useEffect(() => {
    if (!registration) return;
    const check = () => void registration.update();
    const id = setInterval(check, UPDATE_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [registration]);

  const editorOpen = useEditorOpen();
  const pendingWrites = usePendingCount();
  const safeToReload = !editorOpen && pendingWrites === 0;

  useEffect(() => {
    if (needRefresh && safeToReload) void updateServiceWorker(true);
  }, [needRefresh, safeToReload, updateServiceWorker]);

  // Only surfaces while it isn't safe to apply the update silently.
  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
        <span className="text-neutral-700 dark:text-neutral-200">
          An update is ready — it will apply when you finish editing.
        </span>
        <button
          onClick={() => void updateServiceWorker(true)}
          className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Refresh now
        </button>
        <button
          onClick={() => setNeedRefresh(false)}
          aria-label="Dismiss"
          className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
