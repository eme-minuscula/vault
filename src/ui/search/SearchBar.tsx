import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';

/** Global search input in the header. Drives the /search route via the `q` param. */
export function SearchBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const onSearchRoute = location.pathname === '/search';
  const [value, setValue] = useState(onSearchRoute ? (params.get('q') ?? '') : '');

  // Keep the field in sync when the URL query changes underneath us.
  useEffect(() => {
    if (onSearchRoute) setValue(params.get('q') ?? '');
  }, [onSearchRoute, params]);

  function update(next: string) {
    setValue(next);
    const target = `/search?q=${encodeURIComponent(next)}`;
    // Replace while already searching so keystrokes don't flood history.
    void navigate(target, { replace: onSearchRoute });
  }

  return (
    <input
      type="search"
      value={value}
      onChange={(e) => update(e.target.value)}
      placeholder="Search notes…"
      aria-label="Search notes"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
      className="w-40 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:w-56 focus:border-neutral-900 sm:w-56 dark:border-neutral-700 dark:bg-neutral-900 dark:focus:border-neutral-100"
    />
  );
}
