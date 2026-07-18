import { useState } from 'react';
import { useSettings } from '../state/settings';
import { useSync, type SyncError } from '../state/sync';

/** First-run screen: collect the on-device token (and optionally repo config), then sync. */
export function Onboarding() {
  const { token, owner, repo, branch, setToken, setRepo } = useSettings();
  const { status, progress, error, run } = useSync();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const syncing = status === 'syncing';

  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center px-6 py-12">
      <p className="text-sm font-medium tracking-wide text-neutral-400 uppercase">Vault</p>
      <h1 className="mt-2 text-3xl font-semibold text-balance">Connect your vault</h1>
      <p className="mt-3 leading-relaxed text-neutral-500 dark:text-neutral-400">
        Vault reads your private notes straight from GitHub. Your token stays on this device only —
        it is never sent anywhere but GitHub, and never stored on a server.
      </p>

      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">GitHub token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_…"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
          />
          <span className="text-xs text-neutral-400">
            Use a{' '}
            <a
              href="https://github.com/settings/personal-access-tokens"
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-200"
            >
              fine-grained token
            </a>{' '}
            with read access to just your vault repo (add Contents: read &amp; write to edit).
          </span>
        </label>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="self-start text-xs text-neutral-400 underline underline-offset-2 hover:text-neutral-600 dark:hover:text-neutral-200"
        >
          {showAdvanced ? 'Hide' : 'Advanced'} repository settings
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <LabeledInput label="Owner" value={owner} onChange={(v) => setRepo({ owner: v })} />
            <LabeledInput label="Repository" value={repo} onChange={(v) => setRepo({ repo: v })} />
            <LabeledInput label="Branch" value={branch} onChange={(v) => setRepo({ branch: v })} />
          </div>
        )}

        <button
          type="submit"
          disabled={syncing || !token}
          className="mt-1 rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-white dark:text-neutral-900"
        >
          {syncing ? syncingLabel(progress?.phase) : 'Connect'}
        </button>

        {syncing && progress?.phase === 'fetching' && progress.toFetch > 0 && (
          <ProgressBar done={progress.fetched} total={progress.toFetch} />
        )}

        {error && <ErrorNote error={error} />}
      </form>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoCapitalize="off"
        spellCheck={false}
        className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
      />
    </label>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div
          className="h-full rounded-full bg-neutral-900 transition-[width] dark:bg-white"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-neutral-400">
        Fetched {done} of {total} notes
      </span>
    </div>
  );
}

export function ErrorNote({ error }: { error: SyncError }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300"
    >
      {friendlyError(error)}
    </p>
  );
}

function syncingLabel(phase?: string): string {
  switch (phase) {
    case 'listing':
      return 'Listing notes…';
    case 'fetching':
      return 'Downloading…';
    case 'pruning':
      return 'Tidying up…';
    default:
      return 'Connecting…';
  }
}

function friendlyError(error: SyncError): string {
  switch (error.kind) {
    case 'config':
      return error.message;
    case 'auth':
      return 'That token was rejected. Check it has access to this repository.';
    case 'not-found':
      return 'Repository or branch not found. Check the owner, repo, and branch.';
    case 'rate-limit':
      return 'GitHub rate limit reached. Try again a little later.';
    case 'network':
      return 'Could not reach GitHub. Check your connection and try again.';
    default:
      return error.message || 'Something went wrong.';
  }
}
