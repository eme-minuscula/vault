# Vault

A clean, mobile-first **PWA** that is the front door to a private, GitHub-backed
markdown knowledge vault. Read, search, and edit your notes from any device — with a
calm, typographic reading surface (Medium / Notion feel) and a fast offline cache.

> Status: **in active development.** Milestone M0 (foundation) is the current baseline.

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
React Router · Zustand. Editing (WYSIWYG + raw markdown) arrives in a later milestone.

## Roadmap

- **M0 — Foundation**: scaffold, tooling, CI, Pages deploy, reviewer agent. ✅ baseline
- **M1 — Data layer**: token/settings, GitHub Trees sync, IndexedDB cache.
- **M2 — Read & navigate**: vault switcher, folder tree, reading view, wikilinks + backlinks.
- **M3 — Find**: full-text search, filters, redesigned Active view.
- **M4 — Write**: CRUD with lossless WYSIWYG↔markdown editing, offline write queue.
- **M5 — Polish**: install icons, theming, states.
