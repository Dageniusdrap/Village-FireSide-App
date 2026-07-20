# Village Fireside — Monorepo Scaffold (Sub-project 1 of 22)

Status: Approved
Date: 2026-07-21

## Context

Village Fireside is an African tourism, nature, and history audio storytelling
platform ("True African history, nature & stories — told by those who lived
them"). This is the first of 22 sub-projects that will build the product from
the Village Fireside Claude Code Prompt Pack, executed as separate
spec → plan → implementation cycles. This sub-project only scaffolds the
monorepo — no product features yet.

Full roadmap (tracked in the session todo list, not duplicated here):
foundation (schema, storage, auth) → mobile app (shell, discovery, player,
monetization, offline, explore, learn, search/notifications, engagement) →
admin dashboard (content, contributors/consents, payments hardening,
analytics) → launch hardening (security audit, testing/seed data, final
launch audit). "My Fireside" (family recording) is explicitly post-launch
and out of scope for all 22 sub-projects.

## Goals

- A pnpm + Turborepo monorepo with `apps/mobile` (Expo/React Native +
  TypeScript + Expo Router), `apps/admin` (Next.js 14+ App Router +
  TypeScript + Tailwind), and `packages/shared` (shared TS types/constants).
- `supabase/migrations/` for raw SQL migrations, applied by hand via the
  Supabase Studio SQL editor (no Docker, no local Supabase, no Supabase CLI
  migration tooling — an explicit product decision, not an oversight).
- Production-grade engineering baseline from day one: strict TypeScript,
  shared lint/format config, pre-commit hooks, and CI — since this app will
  accumulate 21 more prompts of changes on top of this foundation.
- Both apps boot successfully with no features implemented yet.

## Non-goals

- No database schema, no auth, no UI features — those are later sub-projects.
- No real Supabase project — `.env.example` only, real credentials come from
  the user later.
- No test suite yet (nothing exists to test); CI runs lint + typecheck only.

## Design

### Directory structure

```
village-fireside/
├── apps/
│   ├── mobile/                  Expo (React Native), TypeScript, Expo Router
│   └── admin/                   Next.js 14+ App Router, TypeScript, Tailwind
├── packages/
│   └── shared/                  shared TS types & constants
├── supabase/
│   └── migrations/              raw SQL, timestamped filenames
├── docs/
│   ├── architecture.md
│   └── superpowers/specs/       design docs (this process)
├── .github/workflows/ci.yml
├── .husky/
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

### App identity

- Android `applicationId` / iOS bundle identifier: `com.villagefireside.app`
- Deep link scheme: `villagefireside://`
- Mobile app display name: "Village Fireside"

### Tooling

- **pnpm workspaces** define the monorepo; **Turborepo** (`turbo.json`)
  defines cached/parallel pipelines for `build`, `lint`, `typecheck`, `dev`.
- **TypeScript**: `tsconfig.base.json` at the root with `strict: true`,
  extended by `apps/mobile`, `apps/admin`, and `packages/shared`.
- **ESLint + Prettier**: one shared config (typescript-eslint based) that
  both apps extend rather than duplicating rules per app.
- **Husky + lint-staged**: pre-commit hook runs lint + format on staged
  files only.
- **GitHub Actions** (`.github/workflows/ci.yml`): on push/PR, installs
  with pnpm, runs `turbo lint typecheck` across the monorepo. No test step
  yet — added once Sub-project 21 (Testing & seed data) introduces tests.

### Environment files

`.env.example` in each app, values documented as placeholders:

- `apps/mobile/.env.example`: `EXPO_PUBLIC_SUPABASE_URL`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY` (Expo requires the `EXPO_PUBLIC_` prefix
  for anything bundled into the client).
- `apps/admin/.env.example`: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` — the
  service key is commented as server-only, never to be prefixed
  `NEXT_PUBLIC_` or referenced from client components.

### `.gitignore`

Covers `.env`, `.env.local`, `node_modules`, `.expo/`, `.next/`, `dist/`,
`.turbo/`, and standard OS/editor cruft.

### `docs/architecture.md`

Explains: the monorepo layout; that mobile and admin both talk to Supabase
directly via the client SDK under RLS, except admin server actions which use
the service role key server-side only; and why migrations are hand-applied
via Studio SQL editor rather than the Supabase CLI/Docker (explicit product
choice from the prompt pack, to avoid requiring Docker for this workflow).

## Verification

- `pnpm install` succeeds at the root.
- `npx expo start` boots the mobile app to the default Expo Router screen
  with no crash.
- `npx next dev` boots the admin app to the default page with no crash.
- `turbo lint typecheck` passes with zero errors across all workspaces.
- Git initialized on `main`, initial commit made.

## Out of scope for this sub-project

Everything product-related: database schema, storage buckets, auth, UI
screens, audio playback, monetization, admin CRUD, analytics, security
audit, tests, and launch prep. Each has its own upcoming sub-project.
