import { useRegisterSW } from 'virtual:pwa-register/react';

/** Unobtrusive toast shown when a new app version has been deployed. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      <div className="flex items-center gap-3 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
        <span className="text-neutral-700 dark:text-neutral-200">A new version is available.</span>
        <button
          onClick={() => void updateServiceWorker(true)}
          className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Refresh
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
