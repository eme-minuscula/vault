import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useSettings } from './state/settings';
import { useSync } from './state/sync';
import { Onboarding } from './ui/Onboarding';
import { AppShell } from './ui/AppShell';
import { Library } from './ui/Library';
import { VaultView } from './ui/VaultView';
import { Settings } from './ui/Settings';

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

  // On load, if already connected, quietly check GitHub for changes (a cheap
  // conditional request — 304 when nothing changed).
  useEffect(() => {
    if (connected) void run();
  }, [connected, run]);

  if (!connected) {
    return (
      <div className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        <Onboarding />
      </div>
    );
  }

  return (
    <HashRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<Library />} />
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
  );
}
