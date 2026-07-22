# Vault

A clean, mobile-first **PWA** that is the front door to a private, GitHub-backed
markdown knowledge vault. Read, search, and edit your notes from any device — with a
calm, typographic reading surface (Medium / Notion feel) and a fast offline cache.

> Status: **feature-complete (v1).** Read, search, and edit all work end to end.
> Live at **https://eme-minuscula.github.io/vault/**

## How it works

There is **no application server**. The app is a static site that talks **directly to
the GitHub REST API** using a Personal Access Token you provide at runtime. Your vault
repository stays the single source of truth, so Obsidian-on-desktop, git history, and
any repo automations keep working unchanged.

```
Your device (browser / installed PWA)
  ├─ App shell        ← served statically from GitHub Pages (this repo)
  ├─ Your PAT         ← entered once, stored on-device only
  └─ IndexedDB cache  ← vault content, for instant search + offline reads
        │
        └── GitHub REST API ──> your PRIVATE vault repo (source of truth)
```

## Security boundary (read this)

- **This repo is public** so it can be hosted free on GitHub Pages. It contains **only
  application code — no secrets and no vault content, ever.**
- **Your vault repo stays private.** The app never copies its contents here.
- **Your GitHub token lives only on your device** (in browser storage). It is never
  committed, never logged, and is sent only to `api.github.com`. Because of the
  no-server design, treat the token like a house key: use a **fine-grained token scoped
  to just the vault repo**, install the app only on devices you trust, and revoke/rotate
  the token if a device is lost.
- Every change to this codebase is gated by an independent, security-first code review
  (see `.claude/agents/vault-reviewer.md`) before it is merged.

## Development

```bash
npm install
npm run dev          # local dev server (base path "/", set via VITE_BASE)
npm run build        # typecheck + production build
npm run preview      # preview the production build

npm run lint         # ESLint
npm run typecheck    # tsc, no emit
npm test             # Vitest
npm run format       # Prettier write
```

CI (`.github/workflows/ci.yml`) runs format-check, lint, typecheck, tests, and build on
every PR. On merge to `main`, `.github/workflows/deploy.yml` builds and publishes to
GitHub Pages.

## Tech

React + TypeScript + Vite · Tailwind CSS · vite-plugin-pwa · Dexie (IndexedDB) ·
React Router · Zustand · react-markdown + rehype-sanitize (reading) · Milkdown Crepe
(visual editing, lazy-loaded).

## What it does

- **Read & navigate** — vault switcher, folder browsing, a typographic reading view,
  `[[wikilinks]]` + backlinks.
- **Find** — instant full-text search with vault/active filters, and a redesigned
  Active view of in-flight notes.
- **Write** — create/edit/delete and active-toggle as GitHub commits, with a
  byte-lossless document model and an offline write queue that flushes on reconnect.
- **Edit two ways** — a Notion-style visual editor and raw markdown, toggling per note;
  frontmatter is preserved verbatim and the raw editor is the lossless source of truth.
- **PWA** — installable, offline reading, light/dark themes, update nudge on new deploys.

Supersedes the retired Android app
[vault-keep](https://github.com/eme-minuscula/vault-keep).

## Working on the code

**Scale it targets.** A single user's personal vault — on the order of a thousand
notes across three sub-vaults, some image-heavy. Correct trade-offs are those of a
well-crafted personal tool, not multi-tenant SaaS.

**Sub-vaults.** The repo's top-level folders map to isolated vaults, encoded as the
`VaultId` union in `src/lib/vault/path.ts`: `w/` (work), `m/` (personal), `r/`
(cooking), plus `_inbox` (unfiled captures) and `other`. Isolation is load-bearing —
wikilinks and attachments never resolve across vaults.

**Layering** (imports point downward):

- `src/lib/` — pure logic and IO, framework-free: the GitHub client, sync engine,
  IndexedDB cache (Dexie), frontmatter/markdown/search/link/attachment helpers.
  Functions here take their dependencies (client, db) as explicit arguments.
- `src/state/` — Zustand stores and React hooks (`useLiveQuery` wrappers) that bind
  `lib/` to the UI. No business logic beyond wiring.
- `src/ui/` — components. Navigate with React Router `<Link>`; the one exception is
  the markdown renderer, which needs string hrefs (`noteHref`).

**Invariants pinned by tests** — change these deliberately, and keep the tests green:
byte-lossless note round-trip (`frontmatter/doc.ts`, `sync/toRecord.test.ts`), vault
isolation (`vault/links.ts`, `vault/attachments.ts`), token confinement to
`api.github.com` (`github/client.ts`), the mid-edit update guard (`state/editorGuard.ts`),
and offline-outbox integrity (`vault/mutations.ts`).

**Deliberate trade-offs** (decisions, not bugs): the visual editor may normalize
markdown formatting on save, so notes using extended Obsidian syntax open in raw mode;
wikilinks resolve by filename only (not title/alias yet); external `http(s)` images in
notes aren't loaded (the CSP blocks them, so a private note can't beacon out).
