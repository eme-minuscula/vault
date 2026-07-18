import { useEffect } from 'react';
import { useSettings } from './state/settings';
import { useSync } from './state/sync';
import { Onboarding } from './ui/Onboarding';
import { Home } from './ui/Home';

/**
 * App shell (M1). Routes between first-run onboarding and the synced home based
 * on whether a token is configured. Real in-app navigation lands in M2.
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

  return (
    <div className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {connected ? <Home /> : <Onboarding />}
    </div>
  );
}
