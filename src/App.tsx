/**
 * App shell.
 *
 * This is the M0 foundation placeholder: it establishes the layout, theme, and
 * design language that later milestones build on (data layer, navigation, search,
 * editing). It intentionally ships nothing that touches the GitHub API yet.
 */
export function App() {
  return (
    <div className="min-h-full bg-white text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <main className="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-16">
        <p className="text-sm font-medium tracking-wide text-neutral-400 uppercase">Vault</p>
        <h1 className="mt-3 text-3xl font-semibold text-balance sm:text-4xl">
          Your knowledge, one clean surface.
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-neutral-500 dark:text-neutral-400">
          A mobile-first front end for your private markdown vault. Read, search, and edit — backed
          by your own GitHub repo, with nothing stored on any server but your own.
        </p>
        <p className="mt-8 text-sm text-neutral-400">Foundation ready. Building from here.</p>
      </main>
    </div>
  );
}
