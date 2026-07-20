import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from './state/settings';
import { useSync } from './state/sync';
import { applyTheme, useTheme } from './state/theme';
import { Onboarding } from './ui/Onboarding';
import { AppShell } from './ui/AppShell';
import { Library } from './ui/Library';
import { VaultView } from './ui/VaultView';
import { ActiveView } from './ui/ActiveView';
import { SearchView } from './ui/search/SearchView';
import { EditRoute, NewRoute } from './ui/note/EditRoute';
import { Settings } from './ui/Settings';
import { UpdatePrompt } from './ui/UpdatePrompt';

// The note reader pulls in the markdown engine (remark/rehype). Load it only
// when a note is opened, so the library and onboarding stay lightweight.
const NoteView = lazy(() => import('./ui/note/NoteView').then((m) => ({ default: m.NoteView })));

/**
 * App shell. Onboarding until a token is configured; otherwise the routed app.
 * Hash routing keeps deep links working on GitHub Pages without a server.
 */
export function App() {
  const configured = useSettings((s) => s.configured);
  const hasToken = useSettings((s) => s.token.length > 0);
  const run = useSync((s) => s.run);

  const connected = configured && hasToken;

  // Re-apply whenever the user changes the theme setting.
  const theme = useTheme((s) => s.theme);
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the OS setting while in 'system' mode. Registered once.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(useTheme.getState().theme);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // On load, if already connected, quietly check GitHub for changes (a cheap
  // conditional request — 304 when nothing changed).
  useEffect(() => {
    if (connected) void run();
  }, [connected, run]);

  // When the device comes back online, sync (which also flushes queued writes).
  useEffect(() => {
    if (!connected) return;
    const onOnline = () => void run();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [connected, run]);

  return (
    <>
      {/* Kept at a stable position in the tree: remounting it across the
          onboarding→connected transition would re-register the service worker
          and leak a second update-poll interval. */}
      <UpdatePrompt />

      {!connected ? (
        <div className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
          <Onboarding />
        </div>
      ) : (
        <HashRouter>
          <AppShell>
            <Routes>
              <Route path="/" element={<Library />} />
              <Route path="/search" element={<SearchView />} />
              <Route path="/active" element={<ActiveView />} />
              <Route path="/new" element={<NewRoute />} />
              <Route path="/edit/*" element={<EditRoute />} />
              <Route path="/v/:vault" element={<VaultView />} />
              <Route
                path="/note/*"
                element={
                  <Suspense fallback={<p className="text-sm text-neutral-400">Loading…</p>}>
                    <NoteView />
                  </Suspense>
                }
              />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
        </HashRouter>
      )}
    </>
  );
}
