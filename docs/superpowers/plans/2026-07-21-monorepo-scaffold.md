# Village Fireside Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Village Fireside pnpm + Turborepo monorepo — `apps/mobile` (Expo/React Native + TypeScript + Expo Router), `apps/admin` (Next.js 14+ App Router + TypeScript + Tailwind), `packages/shared`, and `supabase/migrations/` — with shared TypeScript/ESLint config, pre-commit hooks, and CI, so both apps boot with zero product features.

**Architecture:** A pnpm workspace orchestrated by Turborepo. Two shared config packages (`@village-fireside/typescript-config`, `@village-fireside/eslint-config`) are consumed by both apps to avoid duplicated rules. `packages/shared` holds cross-app TypeScript types/constants. No backend code runs yet — Supabase integration is wired in a later sub-project.

**Tech Stack:** pnpm workspaces, Turborepo, TypeScript (strict), Expo + Expo Router, Next.js 14 App Router, Tailwind CSS, ESLint (flat config) + Prettier, Husky + lint-staged, GitHub Actions.

## Global Constraints

- Android `applicationId` / iOS bundle identifier: `com.villagefireside.app` (from spec).
- Deep link scheme: `villagefireside://` (from spec).
- Mobile app display name: "Village Fireside" (from spec).
- TypeScript `strict: true` everywhere (from spec).
- No Supabase CLI / Docker / local Supabase — migrations are hand-applied later via Studio SQL editor; `supabase/migrations/` only needs to exist as a directory in this sub-project (from spec).
- Mobile `.env.example` vars: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (from spec).
- Admin `.env.example` vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, commented as such) (from spec).
- Mobile dependencies to install: `expo-router`, `react-native-track-player`, `zustand`, `@supabase/supabase-js`, `expo-file-system`, `expo-image`, `nativewind`, `react-native-maps`, `expo-notifications`, `react-native-svg` (from spec).
- Admin dependencies to install: `@supabase/supabase-js`, `@supabase/ssr`, `tailwindcss`, `react-hook-form`, `zod` (from spec).
- No tests exist yet; CI runs lint + typecheck only (from spec).
- This repo is already git-initialized on `main` with a remote at `https://github.com/Dageniusdrap/Village-FireSide-App.git` — do not re-run `git init`.

---

### Task 1: Root workspace + Turborepo configuration

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `.gitignore`
- Create: `.nvmrc`
- Create: `.npmrc`

**Interfaces:**
- Produces: the `pnpm-workspace.yaml` glob (`apps/*`, `packages/*`) that every later task's package must fall under to be picked up by pnpm/Turborepo. Root `package.json` scripts (`lint`, `typecheck`, `dev`, `build`) that every later task's app must implement via its own `package.json` scripts of the same name for `turbo run <script>` to work.

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "village-fireside",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "prepare": "husky"
  },
  "devDependencies": {
    "turbo": "^2.3.0",
    "typescript": "^5.7.0",
    "prettier": "^3.4.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.3.0"
  }
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
# dependencies
node_modules/
.pnpm-store/

# env
.env
.env.local
.env.*.local

# build outputs
.next/
dist/
build/
.expo/
.expo-shared/
web-build/

# turbo
.turbo/

# logs
*.log
npm-debug.log*
pnpm-debug.log*

# OS / editor
.DS_Store
.vscode/*
!.vscode/extensions.json
*.swp

# misc
*.tsbuildinfo
```

- [ ] **Step 5: Create `.nvmrc`**

```
20
```

- [ ] **Step 6: Create `.npmrc`**

```
auto-install-peers=true
strict-peer-dependencies=false
```

- [ ] **Step 7: Verify pnpm recognizes the workspace**

Run: `pnpm install`
Expected: completes successfully (only root devDependencies install; "Scope: all 1 workspace projects" or similar — no `apps`/`packages` exist yet, that's fine).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json .gitignore .nvmrc .npmrc pnpm-lock.yaml
git commit -m "chore: initialize pnpm + turborepo workspace"
```

---

### Task 2: Shared TypeScript config package

**Files:**
- Create: `packages/typescript-config/package.json`
- Create: `packages/typescript-config/base.json`
- Create: `packages/typescript-config/nextjs.json`
- Create: `packages/typescript-config/expo.json`

**Interfaces:**
- Consumes: nothing.
- Produces: npm package `@village-fireside/typescript-config` exporting `base.json`, `nextjs.json`, `expo.json`. Task 5 (`apps/mobile`) extends `@village-fireside/typescript-config/expo.json`; Task 6 (`apps/admin`) extends `@village-fireside/typescript-config/nextjs.json`; Task 4 (`packages/shared`) extends `@village-fireside/typescript-config/base.json`.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@village-fireside/typescript-config",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "files": [
    "base.json",
    "nextjs.json",
    "expo.json"
  ]
}
```

- [ ] **Step 2: Create the base config**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **Step 3: Create the Next.js config**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "plugins": [{ "name": "next" }],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": true,
    "jsx": "preserve",
    "incremental": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: Create the Expo config**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "react-native",
    "lib": ["ES2022", "DOM"],
    "noEmit": true
  }
}
```

- [ ] **Step 5: Verify the package is picked up by pnpm**

Run: `pnpm install`
Expected: completes with no errors; `pnpm ls --depth -1` (run from repo root) lists `@village-fireside/typescript-config` under `packages/typescript-config`.

- [ ] **Step 6: Commit**

```bash
git add packages/typescript-config pnpm-lock.yaml
git commit -m "chore: add shared typescript-config package"
```

---

### Task 3: Shared ESLint + Prettier config

**Files:**
- Create: `packages/eslint-config/package.json`
- Create: `packages/eslint-config/base.js`
- Create: `.prettierrc.json` (root)
- Create: `.prettierignore` (root)

**Interfaces:**
- Consumes: nothing.
- Produces: npm package `@village-fireside/eslint-config` exporting a flat-config array `baseConfig` from `base.js`. Task 5's `apps/mobile/eslint.config.js` and Task 6's `apps/admin/eslint.config.mjs` both `import { baseConfig } from "@village-fireside/eslint-config/base"` and spread it into their own flat config array.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@village-fireside/eslint-config",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "main": "./base.js",
  "exports": {
    "./base": "./base.js"
  },
  "dependencies": {
    "@eslint/js": "^9.17.0",
    "eslint-config-prettier": "^9.1.0",
    "typescript-eslint": "^8.18.0"
  }
}
```

- [ ] **Step 2: Create the base flat config**

```javascript
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
export const baseConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ignores: ["dist/**", ".next/**", ".expo/**", "node_modules/**"],
  },
];
```

- [ ] **Step 3: Create root `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 4: Create root `.prettierignore`**

```
pnpm-lock.yaml
.next/
dist/
.expo/
node_modules/
```

- [ ] **Step 5: Install and verify**

Run: `pnpm install`
Expected: completes with no errors; `@village-fireside/eslint-config` resolvable from workspace root (`pnpm ls --depth -1` lists it).

- [ ] **Step 6: Commit**

```bash
git add packages/eslint-config .prettierrc.json .prettierignore pnpm-lock.yaml
git commit -m "chore: add shared eslint-config package and prettier config"
```

---

### Task 4: `packages/shared` scaffold

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `@village-fireside/typescript-config/base.json` (Task 2).
- Produces: npm package `@village-fireside/shared` with a placeholder named export `PACKAGE_NAME`. Later sub-projects (e.g., Prompt 2's DB schema) add real shared types/constants here; this task only proves the package resolves and typechecks across workspaces.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@village-fireside/shared",
  "version": "0.0.0",
  "private": true,
  "license": "UNLICENSED",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@village-fireside/eslint-config": "workspace:*",
    "@village-fireside/typescript-config": "workspace:*",
    "eslint": "^9.17.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "@village-fireside/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `src/index.ts`**

```typescript
export const PACKAGE_NAME = "@village-fireside/shared";
```

- [ ] **Step 4: Create `eslint.config.js`**

```javascript
import { baseConfig } from "@village-fireside/eslint-config/base";

export default [...baseConfig];
```

- [ ] **Step 5: Install and verify typecheck**

Run: `pnpm install && pnpm --filter @village-fireside/shared typecheck`
Expected: exits 0, no output (no errors).

- [ ] **Step 6: Verify lint**

Run: `pnpm --filter @village-fireside/shared lint`
Expected: exits 0, no errors reported.

- [ ] **Step 7: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "chore: scaffold packages/shared"
```

---

### Task 5: `apps/mobile` scaffold (Expo + TypeScript + Expo Router)

**Files:**
- Create: `apps/mobile/` (generated by `create-expo-app`, then modified)
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/tsconfig.json`
- Create: `apps/mobile/eslint.config.js`
- Create: `apps/mobile/.env.example`

**Interfaces:**
- Consumes: `@village-fireside/typescript-config/expo.json` (Task 2), `@village-fireside/eslint-config/base` (Task 3), `@village-fireside/shared` (Task 4, added as a dependency now even though unused, to prove cross-package resolution).
- Produces: a bootable Expo Router app at `apps/mobile` with `applicationId`/bundle id `com.villagefireside.app` and scheme `villagefireside://`, satisfying root scripts `dev`, `lint`, `typecheck`.

- [ ] **Step 1: Scaffold with create-expo-app**

Run (from repo root): `npx create-expo-app@latest apps/mobile --template default`
Expected: `apps/mobile` created with an Expo Router-based TypeScript starter (`app/` directory, `app.json`, `package.json`, `tsconfig.json`).

- [ ] **Step 2: Set app identity in `app.json`**

Open `apps/mobile/app.json` and set (merge into the existing `expo` object, keep other generated keys like `icon`/`splash` placeholders as-is):

```json
{
  "expo": {
    "name": "Village Fireside",
    "slug": "village-fireside",
    "scheme": "villagefireside",
    "ios": {
      "bundleIdentifier": "com.villagefireside.app",
      "supportsTablet": true
    },
    "android": {
      "package": "com.villagefireside.app"
    }
  }
}
```

- [ ] **Step 3: Point `tsconfig.json` at the shared Expo config**

```json
{
  "extends": "@village-fireside/typescript-config/expo.json",
  "compilerOptions": {
    "baseUrl": "."
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 4: Add `lint`/`typecheck` scripts and workspace deps to `apps/mobile/package.json`**

Merge into the generated `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@village-fireside/eslint-config": "workspace:*",
    "@village-fireside/typescript-config": "workspace:*",
    "eslint": "^9.17.0"
  }
}
```

(Keep the generated `lint`, `dev`/`start`, `android`, `ios`, `web` scripts as-is; `create-expo-app` already writes an `eslint.config.js`-compatible `lint` script.)

- [ ] **Step 5: Replace `apps/mobile/eslint.config.js` to extend the shared base**

```javascript
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import { baseConfig } from "@village-fireside/eslint-config/base";

export default defineConfig([expoConfig, ...baseConfig]);
```

- [ ] **Step 6: Install the mobile dependency list from spec**

Run (from repo root):
```bash
pnpm --filter mobile add expo-router react-native-track-player zustand @supabase/supabase-js expo-file-system expo-image nativewind react-native-maps expo-notifications react-native-svg
pnpm --filter mobile add -D tailwindcss
pnpm --filter mobile add @village-fireside/shared@workspace:*
```
Expected: all packages install without peer-dependency errors (`create-expo-app` output names the app package `mobile` by default — confirm via `apps/mobile/package.json`'s `"name"` field before running; adjust the `--filter` value to match if different).

- [ ] **Step 7: Create `apps/mobile/.env.example`**

```
# Client-exposed — Expo requires the EXPO_PUBLIC_ prefix for anything bundled into the app
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 8: Verify typecheck**

Run: `pnpm --filter mobile typecheck`
Expected: exits 0, no errors.

- [ ] **Step 9: Verify lint**

Run: `pnpm --filter mobile lint`
Expected: exits 0, no errors.

- [ ] **Step 10: Verify the app boots**

Run: `pnpm --filter mobile dev -- --port 8081` (or `cd apps/mobile && npx expo start`)
Expected: Metro bundler starts and prints a QR code / "Waiting on http://localhost:8081" with no red error screen in the terminal output. Stop with Ctrl+C once confirmed.

- [ ] **Step 11: Commit**

```bash
git add apps/mobile pnpm-lock.yaml
git commit -m "feat: scaffold apps/mobile with expo router"
```

---

### Task 6: `apps/admin` scaffold (Next.js 14+ App Router + TypeScript + Tailwind)

**Files:**
- Create: `apps/admin/` (generated by `create-next-app`, then modified)
- Modify: `apps/admin/package.json`
- Modify: `apps/admin/tsconfig.json`
- Create: `apps/admin/eslint.config.mjs`
- Create: `apps/admin/.env.example`

**Interfaces:**
- Consumes: `@village-fireside/typescript-config/nextjs.json` (Task 2), `@village-fireside/eslint-config/base` (Task 3), `@village-fireside/shared` (Task 4).
- Produces: a bootable Next.js App Router admin app at `apps/admin`, satisfying root scripts `dev`, `build`, `lint`, `typecheck`.

- [ ] **Step 1: Scaffold with create-next-app**

Run (from repo root): `npx create-next-app@latest apps/admin --typescript --tailwind --app --eslint --src-dir --import-alias "@/*" --use-pnpm`
Expected: `apps/admin` created with App Router, TypeScript, Tailwind, and ESLint pre-wired.

- [ ] **Step 2: Point `tsconfig.json` at the shared Next.js config**

```json
{
  "extends": "@village-fireside/typescript-config/nextjs.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Add `typecheck` script and workspace deps to `apps/admin/package.json`**

Merge into the generated `package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@village-fireside/eslint-config": "workspace:*",
    "@village-fireside/typescript-config": "workspace:*"
  }
}
```

- [ ] **Step 4: Replace `apps/admin/eslint.config.mjs` to extend the shared base**

```javascript
import { FlatCompat } from "@eslint/eslintrc";
import { baseConfig } from "@village-fireside/eslint-config/base";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

export default [...compat.extends("next/core-web-vitals"), ...baseConfig];
```

- [ ] **Step 5: Install the admin dependency list from spec**

Run (from repo root):
```bash
pnpm --filter admin add @supabase/supabase-js @supabase/ssr react-hook-form zod
pnpm --filter admin add @village-fireside/shared@workspace:*
```
Expected: all packages install without errors (`tailwindcss` and `eslint-config-next` are already installed by `create-next-app`; confirm the app package's `"name"` field in `apps/admin/package.json` matches the `--filter admin` used here — adjust if different).

- [ ] **Step 6: Create `apps/admin/.env.example`**

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Server-only. Never prefix with NEXT_PUBLIC_ and never import from a "use client" component.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

- [ ] **Step 7: Verify typecheck**

Run: `pnpm --filter admin typecheck`
Expected: exits 0, no errors.

- [ ] **Step 8: Verify lint**

Run: `pnpm --filter admin lint`
Expected: exits 0, no errors (or only Next's default warnings, none of which are errors).

- [ ] **Step 9: Verify the app boots**

Run: `pnpm --filter admin dev` then request `http://localhost:3000` (e.g. `curl -sSf http://localhost:3000 > /dev/null && echo OK`)
Expected: prints `OK`; stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 10: Commit**

```bash
git add apps/admin pnpm-lock.yaml
git commit -m "feat: scaffold apps/admin with next.js app router"
```

---

### Task 7: Husky pre-commit hook + lint-staged

**Files:**
- Create: `.husky/pre-commit`
- Modify: `package.json` (root) — add `lint-staged` config

**Interfaces:**
- Consumes: root `prepare` script (Task 1, already runs `husky` to install hooks on `pnpm install`).
- Produces: a `pre-commit` git hook that blocks commits containing lint/format failures in staged files.

- [ ] **Step 1: Initialize Husky**

Run: `pnpm exec husky init`
Expected: creates `.husky/pre-commit` (with a default `npm test` line) and adds `"prepare": "husky"` to root `package.json` if not already present (Task 1 already added it — confirm no duplicate).

- [ ] **Step 2: Replace `.husky/pre-commit` contents**

```
pnpm exec lint-staged
```

- [ ] **Step 3: Add `lint-staged` config to root `package.json`**

Add this top-level key to the root `package.json` written in Task 1:

```json
{
  "lint-staged": {
    "*.{ts,tsx,js,jsx,mjs}": ["prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  }
}
```

- [ ] **Step 4: Verify the hook runs**

Run:
```bash
echo "export const x=1" >> packages/shared/src/index.ts
git add packages/shared/src/index.ts
git commit -m "test: verify pre-commit hook"
```
Expected: commit succeeds, `pnpm exec lint-staged` output shows Prettier ran on `packages/shared/src/index.ts`, and `git show --stat HEAD` shows the file reformatted (Prettier adds a space and semicolon: `export const x = 1;`).

- [ ] **Step 5: Revert the test change and confirm hook still installed**

```bash
git revert --no-edit HEAD
```
Expected: revert commit created; `.husky/pre-commit` remains in the repo (revert only touches `packages/shared/src/index.ts`).

- [ ] **Step 6: Commit the hook setup itself**

```bash
git add .husky package.json
git commit -m "chore: add husky pre-commit hook with lint-staged"
```

---

### Task 8: GitHub Actions CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: root `lint` and `typecheck` scripts (Task 1), which fan out via Turborepo to every workspace package's own `lint`/`typecheck` scripts (Tasks 4, 5, 6).
- Produces: nothing consumed by later tasks — this is a leaf/terminal integration.

- [ ] **Step 1: Create the workflow file**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck
```

- [ ] **Step 2: Verify locally that the commands the workflow runs actually pass**

Run: `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck`
Expected: all three commands exit 0 (this is what CI will run — catching a failure locally now is much faster than waiting on a push).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add lint and typecheck workflow"
```

- [ ] **Step 4: Push and confirm the workflow runs green**

Run: `git push origin main`
Then check: `gh run list --limit 1` (wait for it to finish, then `gh run view --log-failed` if it fails)
Expected: the `CI` workflow run for the latest commit shows `completed` / `success`.

---

### Task 9: `docs/architecture.md` and final end-to-end verification

**Files:**
- Create: `docs/architecture.md`
- Create: `supabase/migrations/.gitkeep`

**Interfaces:**
- Consumes: the full monorepo structure from Tasks 1–8 (this task only documents and verifies it; produces nothing new for later tasks).

- [ ] **Step 1: Create `supabase/migrations/.gitkeep`**

```
```

(empty file — git doesn't track empty directories, so this placeholder holds `supabase/migrations/` in the repo until Sub-project 2 adds real migration files)

- [ ] **Step 2: Write `docs/architecture.md`**

```markdown
# Architecture

## Monorepo layout

\```
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
\```

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
```

- [ ] **Step 3: Full end-to-end verification**

Run, from repo root:
```bash
pnpm install
pnpm lint
pnpm typecheck
```
Expected: all three exit 0.

Run: `pnpm --filter mobile dev` (stop after confirming Metro starts cleanly), then `pnpm --filter admin dev` (stop after confirming `curl -sSf http://localhost:3000` returns `OK`).
Expected: both boot with no crash, matching the spec's Verification section.

- [ ] **Step 4: Commit**

```bash
git add docs/architecture.md supabase/migrations/.gitkeep
git commit -m "docs: add architecture overview, add migrations directory placeholder"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```

---

## Self-review notes

- **Spec coverage:** every item in the spec's Design section maps to a task — directory structure (Tasks 1, 4, 5, 6, 9), app identity (Task 5), Turborepo/pnpm (Task 1), TypeScript strict config (Task 2), shared ESLint/Prettier (Task 3), Husky/lint-staged (Task 7), GitHub Actions CI (Task 8), env files (Tasks 5, 6), `.gitignore` (Task 1), `docs/architecture.md` (Task 9), Verification section (Task 9, plus per-app checks in Tasks 5 and 6).
- **Type consistency:** `@village-fireside/typescript-config`, `@village-fireside/eslint-config`, and `@village-fireside/shared` package names are used identically across Tasks 2–6.
- **Known variability:** Tasks 5 and 6 depend on `create-expo-app`/`create-next-app` CLI output, which may shift the generated app package's `"name"` field between CLI versions — each task's dependency-install step calls this out explicitly as a confirm-before-running check rather than assuming a fixed name.
