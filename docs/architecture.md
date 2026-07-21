# Architecture

## Monorepo layout

```
apps/
  mobile/   Expo (React Native) + TypeScript + Expo Router — the consumer app
  admin/    Next.js 14+ App Router + TypeScript + Tailwind — the internal admin dashboard
packages/
  shared/            Cross-app TypeScript types and constants
  typescript-config/ Shared tsconfig bases (base, nextjs, expo)
  eslint-config/      Shared ESLint flat-config base
supabase/
  migrations/         Raw SQL migrations, timestamped, applied by hand
docs/                  Documentation, including design specs and plans
```

## How the pieces connect

- **Mobile → Supabase:** `apps/mobile` talks to Supabase directly via
  `@supabase/supabase-js`, authenticated as the end user. All access is
  governed by Postgres Row Level Security (RLS) policies defined in
  `supabase/migrations/` — the mobile app never has elevated privileges.
- **Admin → Supabase (reads):** `apps/admin` also uses the anon key for
  most reads, subject to the same RLS as any authenticated admin user.
- **Admin → Supabase (privileged writes):** operations that must bypass
  RLS (e.g., crediting coins, publishing content, managing consents) go
  through Next.js **server actions** that use `SUPABASE_SERVICE_ROLE_KEY`.
  This key is never sent to the browser and is never referenced from a
  `"use client"` component — it only exists in server-side code.
- **Shared code:** `packages/shared` holds TypeScript types/constants
  used by both apps (e.g., database row types once the schema exists),
  so the two apps can't silently drift out of sync on shapes they both
  depend on.
- **Config packages:** `packages/typescript-config` and
  `packages/eslint-config` exist so TypeScript/lint rules are defined
  once and extended, not copy-pasted per app.

## Why migrations are hand-applied

This project intentionally does not use the Supabase CLI's local dev
stack (which requires Docker) or CLI-driven migration pushes. Instead,
every file in `supabase/migrations/` is a plain, timestamped `.sql` file
meant to be pasted into the Supabase Studio SQL editor for the project's
one (eventually: dev + prod) Supabase instance. This keeps the local
dev environment lightweight — no Docker requirement — at the cost of
migrations not being applied automatically. `docs/schema.md` (added in
Sub-project 2) documents each migration as it's introduced.

## CI

`.github/workflows/ci.yml` runs `pnpm lint` and `pnpm typecheck` (both
fanned out across every workspace package via Turborepo) on every push
and pull request to `main`. There is no test step yet — one is added
once Sub-project 21 (Testing & seed data) introduces a test suite.

## Adding a new app to the monorepo

A few non-obvious wiring steps are required for a new app to build and
lint cleanly in this scaffold:

- **Extend the right TypeScript base.** Point the new app's `tsconfig.json`
  at the matching variant in `packages/typescript-config` (`nextjs.json`
  for a Next.js app, `expo.json` for an Expo app, or `base.json` directly
  otherwise) rather than hand-rolling `compilerOptions`. Browser-facing
  variants must include DOM types (`"lib": [..., "DOM", "DOM.Iterable"]`)
  — `base.json` only sets `"lib": ["ES2022"]`.
- **Add the ESLint peer workaround.** If the new app bundles its own
  framework ESLint preset (e.g. `eslint-config-next`, `eslint-config-expo`),
  add this to its `package.json` alongside the `@village-fireside/eslint-config`
  devDependency:
  ```json
  "dependenciesMeta": {
    "@village-fireside/eslint-config": { "injected": true }
  }
  ```
  `packages/eslint-config` depends on `typescript-eslint` directly (not as
  a peer dependency), so without this, pnpm can resolve a single shared
  `typescript-eslint` instance whose plugin object collides with the
  separate copy the framework preset bundles for itself, breaking lint at
  the `@typescript-eslint` plugin-instance level. `injected: true` gives
  each consuming app its own correctly-scoped copy instead.
- **Wire up `packages/shared` if you import it.** `packages/shared` ships
  raw, uncompiled TypeScript (`main`/`types` point at `./src/index.ts`,
  no build step). Bundlers that skip transpiling `node_modules`/workspace
  packages by default (e.g. Next.js via webpack/Turbopack) need to be told
  to make an exception. For a Next.js app, add
  `transpilePackages: ["@village-fireside/shared"]` to `next.config.ts`
  before importing from `@village-fireside/shared` — otherwise the first
  build after the import lands will fail. (Metro, used by Expo/React
  Native, does not have this restriction and needs no equivalent config.)
