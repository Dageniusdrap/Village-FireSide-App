# Authentication (Prompt 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement authentication end to end with Supabase Auth across `apps/mobile` (email/password + phone OTP + guest mode) and `apps/admin` (email/password + role-gated proxy), per `docs/PROMPT_PACK.md`'s Prompt 5.

**Architecture:** Mobile holds auth state in a zustand store fed by a single `onAuthStateChange` listener, gates `(auth)`/`(app)` Expo Router route groups via `<Redirect>`, and persists sessions through a chunked `expo-secure-store` adapter. Admin uses `@supabase/ssr`'s browser/server client split and a Next.js 16 `proxy.ts` (the renamed `middleware.ts`) that checks both session and `profiles.role`. Both apps validate forms with zod + react-hook-form via `@hookform/resolvers`.

**Tech Stack:** `@supabase/supabase-js` / `@supabase/ssr`, `expo-secure-store`, `zustand`, `zod`, `react-hook-form`, `@hookform/resolvers`, `jest` + `jest-expo` + `@testing-library/react-native` (mobile tests), `vitest` (admin tests).

## Global Constraints

- **Next.js 16 renamed `middleware.ts` to `proxy.ts`** — the file is `apps/admin/src/proxy.ts`, the exported function is named `proxy` (not `middleware`), confirmed against the installed `next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`. Do not create a `middleware.ts` file.
- **`@supabase/ssr`'s `createServerClient` requires `getAll`/`setAll` cookie methods**, not the deprecated `get`/`set`/`remove` trio (confirmed against the installed `@supabase/ssr@0.12.3` type defs). Always create a fresh client per request — never module-level singleton it.
- **Next.js 16's `cookies()` (from `next/headers`) is async** — always `await cookies()`.
- No Supabase CLI, no Docker, no local Supabase stack, no live Supabase project in this environment — every migration is verified structurally (as in prior prompts), and every screen/network-calling piece of code is verified by `pnpm typecheck` + `pnpm lint` (+ real unit tests where the design spec calls for them), never by running the app against a live backend.
- `expo-secure-store` has a per-key value-size ceiling (~2048 bytes on some platforms) — the storage adapter built in Task 5 must chunk values above that ceiling; this is exercised by that task's own tests, not left as a TODO.
- No zod validation library is `any`-typed shortcut; every schema described below is written out in full, not summarized.
- No rate-limiting, no admin upload UI, no favorites/coins/premium call sites for `useRequireAuth` — all explicitly out of scope for this plan (see the design spec's Non-goals).
- Read `apps/mobile/AGENTS.md` and `apps/admin/AGENTS.md` before writing code in either app — both warn that the installed framework versions (Expo SDK 57, Next.js 16) have breaking changes from older training data. This plan's code has already been checked against the installed `expo-router@57.0.7` and `next@16.2.10` type definitions and docs where it mattered (the `proxy.ts` rename, `cookies()` being async, `<Redirect href="...">` still being current), but if an implementer hits a type error that looks version-related, check the installed package's own `.d.ts` files or `node_modules/next/dist/docs/` before guessing.
- Every migration file is applied exactly once, in filename order; files are not idempotent (no `IF NOT EXISTS` guards), matching every prior prompt's convention.

---

### Task 1: Database — phone-signup display name fallback

**Files:**

- Create: `supabase/migrations/20260723160000_handle_new_user_phone_fallback.sql`

**Interfaces:**

- Consumes: nothing new — `CREATE OR REPLACE FUNCTION handle_new_user()` redefines the function already created in `supabase/migrations/20260721150400_handle_new_user_trigger.sql`; the trigger `on_auth_user_created` already points at this function name and does not need to change.
- Produces: nothing consumed by later tasks in this plan — this is a standalone data-correctness fix.

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/20260723160000_handle_new_user_phone_fallback.sql

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role, coin_balance)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(new.email, '@', 1),
      case
        when new.phone is not null and length(new.phone) >= 4
          then 'Listener •••' || right(new.phone, 4)
      end,
      'New Listener'
    ),
    'listener',
    0
  );
  return new;
end;
$$;
```

- [ ] **Step 2: Verify the file's structure**

```bash
python3 - <<'PY'
sql = open("supabase/migrations/20260723160000_handle_new_user_phone_fallback.sql").read()
assert sql.count("(") == sql.count(")"), "unbalanced parentheses"
assert sql.count("$$") == 2, "expected exactly one $$ ... $$ function body"
assert "create or replace function handle_new_user" in sql
assert "new.phone" in sql, "must add the phone fallback branch"
assert "'New Listener'" in sql, "must keep the final default"
assert "create trigger" not in sql, "must not redefine the trigger — only the function body changes"
print("OK: handle_new_user() redefined with phone fallback, trigger untouched, parens/body balanced")
PY
```

Expected: `OK: handle_new_user() redefined with phone fallback, trigger untouched, parens/body balanced`

- [ ] **Step 3: Verify the original trigger still references this function name**

```bash
grep -q "execute function handle_new_user()" supabase/migrations/20260721150400_handle_new_user_trigger.sql && echo "trigger: OK"
```

Expected: `trigger: OK`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260723160000_handle_new_user_phone_fallback.sql
git commit -m "fix: fall back to a masked phone number in handle_new_user() for phone-only signups"
```

---

### Task 2: Test infrastructure — turbo, mobile Jest, admin Vitest

**Files:**

- Modify: `turbo.json`
- Modify: `package.json` (repo root)
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/jest.config.js`
- Modify: `apps/admin/package.json`
- Create: `apps/admin/vitest.config.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a working `pnpm test` at the repo root (via turbo) and in each app; every later task in this plan that writes a `*.test.ts(x)` file relies on this.

- [ ] **Step 1: Add the `test` task to `turbo.json`**

Read the current file first (whitespace may differ slightly from what's quoted below). Add a `"test"` entry alongside the existing `"lint"`/`"typecheck"` entries in the `"tasks"` object:

```json
"test": {
  "dependsOn": ["^build"]
}
```

- [ ] **Step 2: Add the root `test` script**

Read the current root `package.json` first. Add to its `"scripts"`, alongside the existing `"lint": "turbo run lint"` / `"typecheck": "turbo run typecheck"` entries:

```json
"test": "turbo run test"
```

Without this, `pnpm test` at the repo root has nothing to run — turbo defining the task isn't enough on its own; the root script is what invokes turbo.

- [ ] **Step 3: Install mobile's new dependencies**

```bash
cd apps/mobile
npx expo install expo-secure-store
pnpm add zod react-hook-form @hookform/resolvers
pnpm add -D jest jest-expo @testing-library/react-native @types/jest
cd ../..
```

Use `npx expo install` (not `pnpm add`) for `expo-secure-store` specifically — it resolves the exact version compatible with this project's Expo SDK 57, which a hand-picked version number would risk getting wrong.

- [ ] **Step 4: Add the mobile Jest config**

```js
// apps/mobile/jest.config.js
module.exports = {
  preset: "jest-expo",
};
```

- [ ] **Step 5: Add the mobile `test` script**

In `apps/mobile/package.json`, add to `"scripts"`:

```json
"test": "jest"
```

- [ ] **Step 6: Verify the mobile Jest setup runs (with no test files yet)**

```bash
cd apps/mobile && npx jest --version && cd ../..
```

Expected: prints a Jest version number with no error (confirms `jest-expo` and its peers resolved correctly). Do not run `pnpm test` yet — with zero test files present, both Jest and Vitest treat that as a failure by default, and that's expected until Task 3 adds the first test.

- [ ] **Step 7: Install admin's new dependencies**

```bash
cd apps/admin
pnpm add @hookform/resolvers
pnpm add -D vitest
cd ../..
```

- [ ] **Step 8: Add the admin Vitest config**

```ts
// apps/admin/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 9: Add the admin `test` script**

In `apps/admin/package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 10: Verify the admin Vitest setup runs (with no test files yet)**

```bash
cd apps/admin && npx vitest --version && cd ../..
```

Expected: prints a Vitest version number with no error.

- [ ] **Step 11: Verify lint and typecheck still pass across the workspace**

```bash
pnpm typecheck && pnpm lint
```

Expected: both succeed (no test files exist yet to affect either).

- [ ] **Step 12: Commit**

```bash
git add turbo.json package.json apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/jest.config.js apps/admin/package.json apps/admin/pnpm-lock.yaml apps/admin/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: add test infrastructure (jest-expo, vitest) and auth dependencies"
```

If the workspace uses a single root `pnpm-lock.yaml` (check with `git status` — only files that actually changed need to be added; drop any path above that `git status` doesn't show as modified).

---

### Task 3: Mobile — phone E.164 formatting helper

**Files:**

- Create: `apps/mobile/src/lib/phone.ts`
- Test: `apps/mobile/src/lib/phone.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `COUNTRY_CODES` (a fixed-length literal tuple of `{ name: string; dialCode: string }`, typed via `satisfies` so indexed access like `COUNTRY_CODES[0]` stays non-optional) and `toE164(dialCode: string, localNumber: string): string` — consumed by Task 11's phone-sign-in screen.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/phone.test.ts
import { COUNTRY_CODES, toE164 } from "./phone";

describe("toE164", () => {
  it("combines a dial code and local digits", () => {
    expect(toE164("+254", "712345678")).toBe("+254712345678");
  });

  it("strips a leading 0 from the local number", () => {
    expect(toE164("+254", "0712345678")).toBe("+254712345678");
  });

  it("strips non-digit characters from the local number", () => {
    expect(toE164("+256", "070-123-4567")).toBe("+256701234567");
  });
});

describe("COUNTRY_CODES", () => {
  it("includes at least Kenya, Uganda, Tanzania, Rwanda, Ethiopia, and Nigeria", () => {
    const names = COUNTRY_CODES.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(["Kenya", "Uganda", "Tanzania", "Rwanda", "Ethiopia", "Nigeria"]),
    );
  });

  it("every dial code starts with a plus sign followed by digits", () => {
    for (const country of COUNTRY_CODES) {
      expect(country.dialCode).toMatch(/^\+\d+$/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest src/lib/phone.test.ts
```

Expected: FAIL with a module-not-found error for `./phone`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/phone.ts
export type CountryCode = {
  name: string;
  dialCode: string;
};

// `satisfies` (not a `: readonly CountryCode[]` annotation) keeps this a
// literal tuple type instead of widening it to a general array — with this
// project's `noUncheckedIndexedAccess` tsconfig option, a general array's
// indexed access is `CountryCode | undefined`, but a tuple's fixed-index
// access is not. COUNTRY_CODES[0] must stay non-optional for Task 11's
// default form value.
export const COUNTRY_CODES = [
  { name: "Kenya", dialCode: "+254" },
  { name: "Uganda", dialCode: "+256" },
  { name: "Tanzania", dialCode: "+255" },
  { name: "Rwanda", dialCode: "+250" },
  { name: "Ethiopia", dialCode: "+251" },
  { name: "Nigeria", dialCode: "+234" },
] as const satisfies readonly CountryCode[];

export function toE164(dialCode: string, localNumber: string): string {
  const digitsOnly = localNumber.replace(/\D/g, "");
  const withoutLeadingZero = digitsOnly.replace(/^0+/, "");
  return `${dialCode}${withoutLeadingZero}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest src/lib/phone.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify typecheck and lint**

```bash
cd ../.. && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/phone.ts apps/mobile/src/lib/phone.test.ts
git commit -m "feat: add E.164 phone formatting helper and country code list"
```

---

### Task 4: Mobile — validation schemas

**Files:**

- Create: `apps/mobile/src/lib/validation.ts`
- Test: `apps/mobile/src/lib/validation.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `emailSchema`, `passwordSchema`, `otpSchema`, `localPhoneNumberSchema`, `signInSchema`, `signUpSchema`, `phoneSignInSchema`, `otpVerifySchema`, `forgotPasswordSchema`, `resetPasswordSchema` (all zod schemas), plus their inferred `SignInInput`/`SignUpInput`/`PhoneSignInInput`/`OtpVerifyInput`/`ForgotPasswordInput`/`ResetPasswordInput` types — consumed by Tasks 10, 11, 12's screens.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/validation.test.ts
import {
  emailSchema,
  forgotPasswordSchema,
  localPhoneNumberSchema,
  otpVerifySchema,
  passwordSchema,
  phoneSignInSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
} from "./validation";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse("a@b.com").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });

  it("rejects a string with no @", () => {
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts an 8-character password", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });

  it("rejects a 7-character password", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
  });
});

describe("localPhoneNumberSchema", () => {
  it("accepts 7-15 digits", () => {
    expect(localPhoneNumberSchema.safeParse("712345678").success).toBe(true);
  });

  it("rejects non-digit characters", () => {
    expect(localPhoneNumberSchema.safeParse("712-345").success).toBe(false);
  });

  it("rejects fewer than 7 digits", () => {
    expect(localPhoneNumberSchema.safeParse("12345").success).toBe(false);
  });
});

describe("otpVerifySchema", () => {
  it("accepts a 6-digit code", () => {
    expect(otpVerifySchema.safeParse({ code: "123456" }).success).toBe(true);
  });

  it("rejects a 5-digit code", () => {
    expect(otpVerifySchema.safeParse({ code: "12345" }).success).toBe(false);
  });

  it("rejects a non-numeric code", () => {
    expect(otpVerifySchema.safeParse({ code: "abcdef" }).success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid email and password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });

  it("rejects a missing password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});

describe("signUpSchema", () => {
  it("accepts an optional display name", () => {
    const result = signUpSchema.safeParse({ email: "a@b.com", password: "12345678" });
    expect(result.success).toBe(true);
  });

  it("accepts a provided display name", () => {
    const result = signUpSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      displayName: "Amina",
    });
    expect(result.success).toBe(true);
  });
});

describe("phoneSignInSchema", () => {
  it("accepts a dial code and local number", () => {
    expect(
      phoneSignInSchema.safeParse({ dialCode: "+254", localNumber: "712345678" }).success,
    ).toBe(true);
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "a@b.com" }).success).toBe(true);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts an 8-character password", () => {
    expect(resetPasswordSchema.safeParse({ password: "12345678" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest src/lib/validation.test.ts
```

Expected: FAIL with a module-not-found error for `./validation`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/validation.ts
import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const otpSchema = z.string().regex(/^\d{6}$/, "Enter the 6-digit code");

export const localPhoneNumberSchema = z.string().regex(/^\d{7,15}$/, "Enter a valid phone number");

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignInInput = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().max(60).optional(),
});
export type SignUpInput = z.infer<typeof signUpSchema>;

export const phoneSignInSchema = z.object({
  dialCode: z.string().regex(/^\+\d+$/, "Select a country"),
  localNumber: localPhoneNumberSchema,
});
export type PhoneSignInInput = z.infer<typeof phoneSignInSchema>;

export const otpVerifySchema = z.object({
  code: otpSchema,
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest src/lib/validation.test.ts
```

Expected: PASS, 18 tests.

- [ ] **Step 5: Verify typecheck and lint**

```bash
cd ../.. && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/validation.ts apps/mobile/src/lib/validation.test.ts
git commit -m "feat: add mobile auth form validation schemas"
```

---

### Task 5: Mobile — chunked SecureStore adapter

**Files:**

- Create: `apps/mobile/src/lib/secure-store-adapter.ts`
- Test: `apps/mobile/src/lib/secure-store-adapter.test.ts`

**Interfaces:**

- Consumes: `expo-secure-store`'s `getItemAsync`/`setItemAsync`/`deleteItemAsync`.
- Produces: `secureStoreAdapter: { getItem, setItem, removeItem }` (each `(key: string) => Promise<...>`, matching the `storage` option shape `@supabase/supabase-js` expects) — consumed by Task 6's Supabase client.

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/secure-store-adapter.test.ts
import * as SecureStore from "expo-secure-store";

import { secureStoreAdapter } from "./secure-store-adapter";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) =>
      Promise.resolve(store.has(key) ? (store.get(key) as string) : null),
    ),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

describe("secureStoreAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("round-trips a small value through the plain key", async () => {
    await secureStoreAdapter.setItem("key-a", "short-value");

    expect(await secureStoreAdapter.getItem("key-a")).toBe("short-value");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("key-a", "short-value");
  });

  it("chunks a value larger than the per-key ceiling and reassembles it on read", async () => {
    const large = "x".repeat(5000);
    await secureStoreAdapter.setItem("key-b", large);

    expect(await secureStoreAdapter.getItem("key-b")).toBe(large);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith("key-b", large);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("key-b.chunks", expect.any(String));
  });

  it("removes every chunk key and the count key when removing a chunked value", async () => {
    const large = "y".repeat(5000);
    await secureStoreAdapter.setItem("key-c", large);

    await secureStoreAdapter.removeItem("key-c");

    expect(await secureStoreAdapter.getItem("key-c")).toBeNull();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("key-c.chunks");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("key-c.0");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("key-c");
  });

  it("getItem returns null for a key that was never set", async () => {
    expect(await secureStoreAdapter.getItem("key-d")).toBeNull();
  });

  it("setItem on an existing chunked key clears the old chunks first", async () => {
    const large = "z".repeat(5000);
    await secureStoreAdapter.setItem("key-e", large);
    await secureStoreAdapter.setItem("key-e", "short-again");

    expect(await secureStoreAdapter.getItem("key-e")).toBe("short-again");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest src/lib/secure-store-adapter.test.ts
```

Expected: FAIL with a module-not-found error for `./secure-store-adapter`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/mobile/src/lib/secure-store-adapter.ts
import * as SecureStore from "expo-secure-store";

const CHUNK_SIZE = 1800; // stays under expo-secure-store's ~2048-byte per-key ceiling
const CHUNK_COUNT_SUFFIX = ".chunks";

function chunkKey(key: string, index: number): string {
  return `${key}.${index}`;
}

async function removeItem(key: string): Promise<void> {
  const chunkCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (chunkCountRaw !== null) {
    const chunkCount = Number(chunkCountRaw);
    for (let i = 0; i < chunkCount; i++) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
    await SecureStore.deleteItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  }
  await SecureStore.deleteItemAsync(key);
}

async function setItem(key: string, value: string): Promise<void> {
  await removeItem(key);

  if (value.length <= CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    return;
  }

  const chunkCount = Math.ceil(value.length / CHUNK_SIZE);
  for (let i = 0; i < chunkCount; i++) {
    const chunk = value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    await SecureStore.setItemAsync(chunkKey(key, i), chunk);
  }
  await SecureStore.setItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`, String(chunkCount));
}

async function getItem(key: string): Promise<string | null> {
  const chunkCountRaw = await SecureStore.getItemAsync(`${key}${CHUNK_COUNT_SUFFIX}`);
  if (chunkCountRaw === null) {
    return SecureStore.getItemAsync(key);
  }

  const chunkCount = Number(chunkCountRaw);
  const chunks: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    const chunk = await SecureStore.getItemAsync(chunkKey(key, i));
    if (chunk === null) {
      return null;
    }
    chunks.push(chunk);
  }
  return chunks.join("");
}

export const secureStoreAdapter = { getItem, setItem, removeItem };
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest src/lib/secure-store-adapter.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Verify typecheck and lint**

```bash
cd ../.. && pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/secure-store-adapter.ts apps/mobile/src/lib/secure-store-adapter.test.ts
git commit -m "feat: add chunked expo-secure-store adapter for Supabase session persistence"
```

---

### Task 6: Mobile — Supabase client

**Files:**

- Create: `apps/mobile/src/lib/supabase.ts`

**Interfaces:**

- Consumes: `secureStoreAdapter` (Task 5); `process.env.EXPO_PUBLIC_SUPABASE_URL` / `process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY` (already documented in `apps/mobile/.env.example`).
- Produces: `supabase: SupabaseClient` — consumed by Tasks 7 (auth listener), 9 (placeholder home screen's profile fetch), 10, 11, 12 (screens' sign-in/up/OTP/reset calls).

No test for this file — it's a thin, side-effecting client construction with nothing pure to unit test; it's exercised indirectly by every later task's typecheck.

- [ ] **Step 1: Write the file**

```ts
// apps/mobile/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

import { secureStoreAdapter } from "./secure-store-adapter";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY — copy apps/mobile/.env.example to apps/mobile/.env and fill in your Supabase project values.",
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: secureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
```

- [ ] **Step 2: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both pass. (This file will fail at _runtime_ without a real `.env` — that's expected and matches this environment's established "no live Supabase project" constraint; typecheck/lint don't execute the module.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/supabase.ts
git commit -m "feat: add mobile Supabase client with secure-store-backed session persistence"
```

---

### Task 7: Mobile — auth store and auth listener

**Files:**

- Create: `apps/mobile/src/stores/auth-store.ts`
- Create: `apps/mobile/src/hooks/use-auth-listener.ts`

**Interfaces:**

- Consumes: `supabase` (Task 6).
- Produces: `useAuthStore` (zustand hook exposing `session: Session | null`, `guestMode: boolean`, `passwordRecovery: boolean`, `loading: boolean`, `continueAsGuest(): void`, `signOut(): Promise<void>`) and `useAuthListener(): void` — consumed by Task 8 (`useRequireAuth`), Task 9 (root layout + placeholder home), Task 10/11/12 (screens read `continueAsGuest`/`signOut`, and the reset-password screen reads `passwordRecovery`).

No test for these two files: `auth-store.ts` is a thin zustand definition with no branching logic of its own to assert on, and `use-auth-listener.ts` only wires a third-party subscription to store setters — there's nothing here that isn't already covered by Task 8's test (which mocks this exact store) or by typecheck.

- [ ] **Step 1: Write the auth store**

```ts
// apps/mobile/src/stores/auth-store.ts
import type { Session } from "@supabase/supabase-js";
import { create } from "zustand";

import { supabase } from "@/lib/supabase";

type AuthState = {
  session: Session | null;
  guestMode: boolean;
  passwordRecovery: boolean;
  loading: boolean;
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
  _setSession: (session: Session | null) => void;
  _setLoading: (loading: boolean) => void;
  _setPasswordRecovery: (passwordRecovery: boolean) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  guestMode: false,
  passwordRecovery: false,
  loading: true,
  continueAsGuest: () => set({ guestMode: true }),
  signOut: async () => {
    await supabase.auth.signOut();
    set({ guestMode: false, passwordRecovery: false });
  },
  _setSession: (session) => set({ session }),
  _setLoading: (loading) => set({ loading }),
  _setPasswordRecovery: (passwordRecovery) => set({ passwordRecovery }),
}));
```

- [ ] **Step 2: Write the auth listener hook**

```ts
// apps/mobile/src/hooks/use-auth-listener.ts
import { useEffect } from "react";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export function useAuthListener(): void {
  useEffect(() => {
    const setSession = useAuthStore.getState()._setSession;
    const setLoading = useAuthStore.getState()._setLoading;
    const setPasswordRecovery = useAuthStore.getState()._setPasswordRecovery;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setPasswordRecovery(true);
      }
      setSession(session);
      setLoading(false);
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, []);
}
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/stores/auth-store.ts apps/mobile/src/hooks/use-auth-listener.ts
git commit -m "feat: add mobile auth store and auth-state-change listener"
```

---

### Task 8: Mobile — guest-mode gate primitive

**Files:**

- Create: `apps/mobile/src/hooks/use-require-auth.ts`
- Test: `apps/mobile/src/hooks/use-require-auth.test.ts`
- Create: `apps/mobile/src/components/form-error.tsx`
- Create: `apps/mobile/src/components/sign-in-prompt-sheet.tsx`

**Interfaces:**

- Consumes: `useAuthStore` (Task 7).
- Produces: `useRequireAuth(): { requireAuth: (action: () => void) => void; promptVisible: boolean; dismissPrompt: () => void }`, `<FormError message?: string />`, `<SignInPromptSheet visible: boolean; onDismiss: () => void; onSignIn: () => void; onSignUp: () => void />` — `FormError` is consumed by Tasks 10-12's screens; `useRequireAuth` and `SignInPromptSheet` are inert in this plan (no call sites yet, per the design spec's scope decision) but are fully implemented and tested so Prompt 6+ can adopt them directly.

- [ ] **Step 1: Write the failing test for `useRequireAuth`**

```ts
// apps/mobile/src/hooks/use-require-auth.test.ts
import { act, renderHook } from "@testing-library/react-native";

import { useAuthStore } from "@/stores/auth-store";

import { useRequireAuth } from "./use-require-auth";

jest.mock("@/stores/auth-store", () => ({
  useAuthStore: jest.fn(),
}));

type MockState = { session: { id: string } | null; guestMode: boolean };

const mockUseAuthStore = useAuthStore as unknown as jest.Mock;

function mockStoreState(state: MockState) {
  mockUseAuthStore.mockImplementation((selector: (s: MockState) => unknown) => selector(state));
}

describe("useRequireAuth", () => {
  it("calls the action immediately when signed in", () => {
    mockStoreState({ session: { id: "user-1" }, guestMode: false });
    const { result } = renderHook(() => useRequireAuth());
    const action = jest.fn();

    act(() => {
      result.current.requireAuth(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
    expect(result.current.promptVisible).toBe(false);
  });

  it("opens the sign-in prompt instead of running the action in guest mode", () => {
    mockStoreState({ session: null, guestMode: true });
    const { result } = renderHook(() => useRequireAuth());
    const action = jest.fn();

    act(() => {
      result.current.requireAuth(action);
    });

    expect(action).not.toHaveBeenCalled();
    expect(result.current.promptVisible).toBe(true);
  });

  it("dismissPrompt closes the prompt", () => {
    mockStoreState({ session: null, guestMode: true });
    const { result } = renderHook(() => useRequireAuth());

    act(() => {
      result.current.requireAuth(jest.fn());
    });
    expect(result.current.promptVisible).toBe(true);

    act(() => {
      result.current.dismissPrompt();
    });
    expect(result.current.promptVisible).toBe(false);
  });

  it("does nothing when neither signed in nor in guest mode", () => {
    mockStoreState({ session: null, guestMode: false });
    const { result } = renderHook(() => useRequireAuth());
    const action = jest.fn();

    act(() => {
      result.current.requireAuth(action);
    });

    expect(action).not.toHaveBeenCalled();
    expect(result.current.promptVisible).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/mobile && npx jest src/hooks/use-require-auth.test.ts
```

Expected: FAIL with a module-not-found error for `./use-require-auth`.

- [ ] **Step 3: Write the `useRequireAuth` implementation**

```ts
// apps/mobile/src/hooks/use-require-auth.ts
import { useCallback, useState } from "react";

import { useAuthStore } from "@/stores/auth-store";

export function useRequireAuth() {
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const [promptVisible, setPromptVisible] = useState(false);

  const requireAuth = useCallback(
    (action: () => void) => {
      if (session) {
        action();
        return;
      }
      if (guestMode) {
        setPromptVisible(true);
      }
    },
    [session, guestMode],
  );

  const dismissPrompt = useCallback(() => setPromptVisible(false), []);

  return { requireAuth, promptVisible, dismissPrompt };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/mobile && npx jest src/hooks/use-require-auth.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write `FormError`**

```tsx
// apps/mobile/src/components/form-error.tsx
import { StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { Spacing } from "@/constants/theme";

export function FormError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <ThemedText type="small" themeColor="text" style={styles.error}>
      {message}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  error: {
    color: "#C0392B",
    marginTop: Spacing.one,
  },
});
```

- [ ] **Step 6: Write `SignInPromptSheet`**

```tsx
// apps/mobile/src/components/sign-in-prompt-sheet.tsx
import { Modal, Pressable, StyleSheet } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";

export function SignInPromptSheet({
  visible,
  onDismiss,
  onSignIn,
  onSignUp,
}: {
  visible: boolean;
  onDismiss: () => void;
  onSignIn: () => void;
  onSignUp: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        <ThemedView style={styles.sheet}>
          <ThemedText type="subtitle">Sign in to continue</ThemedText>
          <ThemedText type="default">
            Create a free account or sign in to save your progress.
          </ThemedText>
          <Pressable style={styles.primaryButton} onPress={onSignIn}>
            <ThemedText type="default" themeColor="background">
              Sign In
            </ThemedText>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onSignUp}>
            <ThemedText type="linkPrimary">Create Account</ThemedText>
          </Pressable>
        </ThemedView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0, 0, 0, 0.4)",
  },
  sheet: {
    padding: Spacing.four,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
    gap: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: Spacing.two,
  },
});
```

- [ ] **Step 7: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 8: Commit**

```bash
git add apps/mobile/src/hooks/use-require-auth.ts apps/mobile/src/hooks/use-require-auth.test.ts apps/mobile/src/components/form-error.tsx apps/mobile/src/components/sign-in-prompt-sheet.tsx
git commit -m "feat: add guest-mode auth gate primitive (useRequireAuth + SignInPromptSheet)"
```

---

### Task 9: Mobile — root layout restructure and route groups

**Files:**

- Delete: `apps/mobile/src/app/index.tsx`
- Delete: `apps/mobile/src/app/explore.tsx`
- Delete: `apps/mobile/src/components/app-tabs.tsx`
- Modify: `apps/mobile/src/app/_layout.tsx`
- Create: `apps/mobile/src/app/(auth)/_layout.tsx`
- Create: `apps/mobile/src/app/(app)/_layout.tsx`
- Create: `apps/mobile/src/app/(app)/index.tsx`

**Interfaces:**

- Consumes: `useAuthListener` (Task 7), `useAuthStore` (Task 7), `supabase` (Task 6).
- Produces: the `(auth)` and `(app)` Expo Router groups that Tasks 10-12 add screens into; the redirect gate every later screen relies on for reachability.

No test for these files — Expo Router navigation and redirect behavior can't be exercised by `jest-expo` unit tests without a full app runtime (no simulator/device in this environment, per the design spec's testing scope); this task is verified by typecheck/lint and a careful read of the redirect logic below.

- [ ] **Step 1: Delete the old default screens and tab component**

```bash
cd apps/mobile
git rm src/app/index.tsx src/app/explore.tsx src/components/app-tabs.tsx
cd ../..
```

- [ ] **Step 2: Rewrite the root layout**

```tsx
// apps/mobile/src/app/_layout.tsx
import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, useColorScheme } from "react-native";

import { AnimatedSplashOverlay } from "@/components/animated-icon";
import { ThemedView } from "@/components/themed-view";
import { useAuthListener } from "@/hooks/use-auth-listener";
import { useAuthStore } from "@/stores/auth-store";

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  useAuthListener();

  const loading = useAuthStore((state) => state.loading);
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);

  useEffect(() => {
    if (!loading) {
      SplashScreen.hideAsync();
    }
  }, [loading]);

  const theme = colorScheme === "dark" ? DarkTheme : DefaultTheme;

  if (loading) {
    return (
      <ThemeProvider value={theme}>
        <ThemedView style={styles.loadingContainer}>
          <ActivityIndicator />
        </ThemedView>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider value={theme}>
      <AnimatedSplashOverlay />
      {!session && !guestMode && <Redirect href="/welcome" />}
      {(session || guestMode) && <Redirect href="/" />}
      <Slot />
    </ThemeProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
```

- [ ] **Step 3: Write the `(auth)` group layout**

```tsx
// apps/mobile/src/app/(auth)/_layout.tsx
import { Stack } from "expo-router";

export default function AuthLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 4: Write the `(app)` group layout**

```tsx
// apps/mobile/src/app/(app)/_layout.tsx
import { Stack } from "expo-router";

export default function AppLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 5: Write the placeholder authenticated screen**

```tsx
// apps/mobile/src/app/(app)/index.tsx
import { useEffect, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export default function AppHomeScreen() {
  const session = useAuthStore((state) => state.session);
  const guestMode = useAuthStore((state) => state.guestMode);
  const signOut = useAuthStore((state) => state.signOut);

  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setDisplayName(null);
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select("display_name")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!cancelled) {
          setDisplayName(data?.display_name ?? null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">
          {guestMode ? "Browsing as Guest" : `Signed in as ${displayName ?? "…"}`}
        </ThemedText>
        <Pressable style={styles.button} onPress={() => void signOut()}>
          <ThemedText type="linkPrimary">{guestMode ? "Sign In" : "Sign Out"}</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.four,
  },
  button: {
    padding: Spacing.three,
  },
});
```

- [ ] **Step 6: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

Expected: both pass, with no remaining references to the deleted `app-tabs`/`explore` files anywhere (typecheck would fail with an unresolved-import error if any reference remained).

- [ ] **Step 7: Commit**

```bash
git add -A apps/mobile/src/app apps/mobile/src/components
git commit -m "feat: replace mobile tab shell with auth-gated (auth)/ route groups"
```

---

### Task 10: Mobile — Welcome, Sign In, Sign Up screens

**Files:**

- Create: `apps/mobile/src/app/(auth)/welcome.tsx`
- Create: `apps/mobile/src/app/(auth)/sign-in.tsx`
- Create: `apps/mobile/src/app/(auth)/sign-up.tsx`

**Interfaces:**

- Consumes: `supabase` (Task 6), `useAuthStore` (Task 7, for `continueAsGuest`), `signInSchema`/`signUpSchema`/`SignInInput`/`SignUpInput` (Task 4), `FormError` (Task 8).
- Produces: the three screens `(auth)/welcome`, `(auth)/sign-in`, `(auth)/sign-up` that Task 9's root-layout redirect points to and that Task 11's phone-sign-in screen links back from.

No unit tests — per the design spec's testing scope, full screen rendering isn't unit-tested in this environment; verified by typecheck/lint.

- [ ] **Step 1: Write the Welcome screen**

```tsx
// apps/mobile/src/app/(auth)/welcome.tsx
import { useRouter } from "expo-router";
import { Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { useAuthStore } from "@/stores/auth-store";

export default function WelcomeScreen() {
  const router = useRouter();
  const continueAsGuest = useAuthStore((state) => state.continueAsGuest);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Village Fireside</ThemedText>
        <ThemedText type="default">Stories, told by the people who lived them.</ThemedText>

        <Pressable style={styles.primaryButton} onPress={() => router.push("/sign-in")}>
          <ThemedText type="default" themeColor="background">
            Sign In
          </ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/sign-up")}>
          <ThemedText type="linkPrimary">Create Account</ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={continueAsGuest}>
          <ThemedText type="link">Continue as Guest</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  primaryButton: {
    alignSelf: "stretch",
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
  },
});
```

- [ ] **Step 2: Write the Sign In screen**

```tsx
// apps/mobile/src/app/(auth)/sign-in.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type SignInInput, signInSchema } from "@/lib/validation";

export default function SignInScreen() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: SignInInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setApiError(error.message);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Sign In</ThemedText>

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.email?.message} />

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Password"
              secureTextEntry
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.password?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Signing In…" : "Sign In"}
          </ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/phone-sign-in")}>
          <ThemedText type="linkPrimary">Use phone number instead</ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => router.push("/forgot-password")}>
          <ThemedText type="link">Forgot password?</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
    alignItems: "center",
  },
});
```

- [ ] **Step 3: Write the Sign Up screen**

```tsx
// apps/mobile/src/app/(auth)/sign-up.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type SignUpInput, signUpSchema } from "@/lib/validation";

export default function SignUpScreen() {
  const [apiError, setApiError] = useState<string | undefined>();
  const [confirmationSent, setConfirmationSent] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpInput>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  const onSubmit = async (values: SignUpInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: values.displayName ? { data: { display_name: values.displayName } } : undefined,
    });
    if (error) {
      setApiError(error.message);
      return;
    }
    setConfirmationSent(true);
  };

  if (confirmationSent) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Check your email</ThemedText>
          <ThemedText type="default">
            We sent a confirmation link — open it to finish creating your account.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Create Account</ThemedText>

        <Controller
          control={control}
          name="displayName"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Display name (optional)"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.displayName?.message} />

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.email?.message} />

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Password"
              secureTextEntry
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.password?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Creating Account…" : "Create Account"}
          </ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
});
```

- [ ] **Step 4: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/\(auth\)/welcome.tsx apps/mobile/src/app/\(auth\)/sign-in.tsx apps/mobile/src/app/\(auth\)/sign-up.tsx
git commit -m "feat: add Welcome, Sign In, and Sign Up screens"
```

---

### Task 11: Mobile — Phone sign-in and OTP verify screens

**Files:**

- Create: `apps/mobile/src/app/(auth)/phone-sign-in.tsx`
- Create: `apps/mobile/src/app/(auth)/otp-verify.tsx`

**Interfaces:**

- Consumes: `supabase` (Task 6), `COUNTRY_CODES`/`toE164` (Task 3), `phoneSignInSchema`/`otpVerifySchema`/`PhoneSignInInput`/`OtpVerifyInput` (Task 4), `FormError` (Task 8).
- Produces: the two screens, linked from Task 10's Sign In screen (`router.push('/phone-sign-in')`).

No unit tests — same reasoning as Task 10 (full screen rendering out of this plan's testing scope); verified by typecheck/lint.

- [ ] **Step 1: Write the phone sign-in screen**

```tsx
// apps/mobile/src/app/(auth)/phone-sign-in.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { COUNTRY_CODES, toE164 } from "@/lib/phone";
import { type PhoneSignInInput, phoneSignInSchema } from "@/lib/validation";

export default function PhoneSignInScreen() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PhoneSignInInput>({
    resolver: zodResolver(phoneSignInSchema),
    defaultValues: { dialCode: COUNTRY_CODES[0].dialCode, localNumber: "" },
  });

  const onSubmit = async (values: PhoneSignInInput) => {
    setApiError(undefined);
    const phone = toE164(values.dialCode, values.localNumber);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      setApiError(error.message);
      return;
    }
    router.push({ pathname: "/otp-verify", params: { phone } });
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <ThemedText type="title">Phone Sign In</ThemedText>
          <ThemedText type="default">
            Enter your phone number to sign in or create an account.
          </ThemedText>

          <ThemedText type="smallBold">Country</ThemedText>
          <Controller
            control={control}
            name="dialCode"
            render={({ field }) => (
              <ThemedView style={styles.countryList}>
                {COUNTRY_CODES.map((country) => (
                  <Pressable
                    key={country.dialCode}
                    style={[
                      styles.countryOption,
                      field.value === country.dialCode && styles.countryOptionSelected,
                    ]}
                    onPress={() => field.onChange(country.dialCode)}
                  >
                    <ThemedText type="small">
                      {country.name} ({country.dialCode})
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            )}
          />
          <FormError message={errors.dialCode?.message} />

          <Controller
            control={control}
            name="localNumber"
            render={({ field }) => (
              <TextInput
                style={styles.input}
                placeholder="Phone number"
                keyboardType="phone-pad"
                onChangeText={field.onChange}
                value={field.value}
              />
            )}
          />
          <FormError message={errors.localNumber?.message} />
          <FormError message={apiError} />

          <Pressable
            style={styles.primaryButton}
            disabled={isSubmitting}
            onPress={handleSubmit(onSubmit)}
          >
            <ThemedText type="default" themeColor="background">
              {isSubmitting ? "Sending Code…" : "Send Code"}
            </ThemedText>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
  },
  countryList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  countryOption: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  countryOptionSelected: {
    borderColor: "#1F3B2C",
    borderWidth: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
});
```

- [ ] **Step 2: Write the OTP verify screen**

```tsx
// apps/mobile/src/app/(auth)/otp-verify.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type OtpVerifyInput, otpVerifySchema } from "@/lib/validation";

const RESEND_COOLDOWN_SECONDS = 30;

export default function OtpVerifyScreen() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const [apiError, setApiError] = useState<string | undefined>();
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OtpVerifyInput>({
    resolver: zodResolver(otpVerifySchema),
    defaultValues: { code: "" },
  });

  useEffect(() => {
    if (cooldown === 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const onSubmit = async (values: OtpVerifyInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.verifyOtp({
      phone,
      token: values.code,
      type: "sms",
    });
    if (error) {
      setApiError(error.message);
    }
    // On success, the auth-state-change listener updates the store and the
    // root layout's <Redirect> takes the user to (app) — no navigation call needed here.
  };

  const handleResend = async () => {
    setApiError(undefined);
    const { error } = await supabase.auth.signInWithOtp({ phone });
    if (error) {
      setApiError(error.message);
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
  };

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Enter the Code</ThemedText>
        <ThemedText type="default">We sent a 6-digit code to {phone}.</ThemedText>

        <Controller
          control={control}
          name="code"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              keyboardType="number-pad"
              maxLength={6}
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.code?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Verifying…" : "Verify"}
          </ThemedText>
        </Pressable>

        <Pressable style={styles.secondaryButton} disabled={cooldown > 0} onPress={handleResend}>
          <ThemedText type="linkPrimary">
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
    textAlign: "center",
    letterSpacing: Spacing.two,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
  secondaryButton: {
    paddingVertical: Spacing.two,
    alignItems: "center",
  },
});
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/app/\(auth\)/phone-sign-in.tsx apps/mobile/src/app/\(auth\)/otp-verify.tsx
git commit -m "feat: add phone sign-in and OTP verify screens"
```

---

### Task 12: Mobile — Forgot password and reset password screens

**Files:**

- Create: `apps/mobile/src/app/(auth)/forgot-password.tsx`
- Create: `apps/mobile/src/app/(auth)/reset-password.tsx`
- Modify: `apps/mobile/app.json`

**Interfaces:**

- Consumes: `supabase` (Task 6), `useAuthStore` (Task 7, for `passwordRecovery`), `forgotPasswordSchema`/`resetPasswordSchema`/`ForgotPasswordInput`/`ResetPasswordInput` (Task 4), `FormError` (Task 8).
- Produces: the two screens, linked from Task 10's Sign In screen (`router.push('/forgot-password')`).

No unit tests — same reasoning as Tasks 10-11.

- [ ] **Step 1: Write the forgot password screen**

```tsx
// apps/mobile/src/app/(auth)/forgot-password.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type ForgotPasswordInput, forgotPasswordSchema } from "@/lib/validation";

export default function ForgotPasswordScreen() {
  const [apiError, setApiError] = useState<string | undefined>();
  const [sent, setSent] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });

  const onSubmit = async (values: ForgotPasswordInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: "villagefireside://reset-password",
    });
    if (error) {
      setApiError(error.message);
      return;
    }
    setSent(true);
  };

  if (sent) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Check your email</ThemedText>
          <ThemedText type="default">
            If an account exists for that address, we've sent a password reset link.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Forgot Password</ThemedText>

        <Controller
          control={control}
          name="email"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.email?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Sending…" : "Send Reset Link"}
          </ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
});
```

- [ ] **Step 2: Write the reset password screen**

```tsx
// apps/mobile/src/app/(auth)/reset-password.tsx
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Pressable, StyleSheet, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { FormError } from "@/components/form-error";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Spacing } from "@/constants/theme";
import { supabase } from "@/lib/supabase";
import { type ResetPasswordInput, resetPasswordSchema } from "@/lib/validation";
import { useAuthStore } from "@/stores/auth-store";

export default function ResetPasswordScreen() {
  const passwordRecovery = useAuthStore((state) => state.passwordRecovery);
  const [apiError, setApiError] = useState<string | undefined>();
  const [done, setDone] = useState(false);
  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "" },
  });

  const onSubmit = async (values: ResetPasswordInput) => {
    setApiError(undefined);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) {
      setApiError(error.message);
      return;
    }
    setDone(true);
  };

  if (!passwordRecovery) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Link expired</ThemedText>
          <ThemedText type="default">
            This password reset link is no longer valid — request a new one from the Sign In screen.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (done) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title">Password updated</ThemedText>
          <ThemedText type="default">
            You're all set — you can now sign in with your new password.
          </ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Set a New Password</ThemedText>

        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <TextInput
              style={styles.input}
              placeholder="New password"
              secureTextEntry
              onChangeText={field.onChange}
              value={field.value}
            />
          )}
        />
        <FormError message={errors.password?.message} />
        <FormError message={apiError} />

        <Pressable
          style={styles.primaryButton}
          disabled={isSubmitting}
          onPress={handleSubmit(onSubmit)}
        >
          <ThemedText type="default" themeColor="background">
            {isSubmitting ? "Saving…" : "Save Password"}
          </ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: "center",
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  input: {
    borderWidth: 1,
    borderColor: "#CCCCCC",
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.three,
  },
  primaryButton: {
    backgroundColor: "#1F3B2C",
    borderRadius: Spacing.two,
    paddingVertical: Spacing.three,
    alignItems: "center",
    marginTop: Spacing.four,
  },
});
```

- [ ] **Step 3: Verify `app.json`'s deep-link scheme already covers this route**

```bash
grep -q '"scheme": "villagefireside"' apps/mobile/app.json && echo "scheme: OK"
```

Expected: `scheme: OK`. Expo Router automatically maps `villagefireside://reset-password` to `src/app/(auth)/reset-password.tsx` via its file-based routing — no additional `app.json` linking config is needed beyond the scheme already being present. (This step only verifies the existing config; it does not modify `app.json`.)

- [ ] **Step 4: Verify typecheck and lint**

```bash
cd apps/mobile && pnpm typecheck && pnpm lint
```

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/app/\(auth\)/forgot-password.tsx apps/mobile/src/app/\(auth\)/reset-password.tsx
git commit -m "feat: add forgot password and reset password screens"
```

---

### Task 13: Admin — Supabase clients

**Files:**

- Create: `apps/admin/src/lib/supabase/client.ts`
- Create: `apps/admin/src/lib/supabase/server.ts`

**Interfaces:**

- Consumes: `process.env.NEXT_PUBLIC_SUPABASE_URL` / `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` (already in `apps/admin/.env.example`); Next.js's `cookies()` from `next/headers`.
- Produces: `createClient(): SupabaseClient` (browser, `apps/admin/src/lib/supabase/client.ts`) and `createClient(): Promise<SupabaseClient>` (server, `apps/admin/src/lib/supabase/server.ts`) — consumed by Task 15's `proxy.ts` and Task 16's sign-in page.

No unit test — thin client construction, same reasoning as Task 6.

- [ ] **Step 1: Write the browser client**

```ts
// apps/admin/src/lib/supabase/client.ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Write the server client**

```ts
// apps/admin/src/lib/supabase/server.ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component that can't set cookies — safe to
            // ignore here because the proxy (Task 15) refreshes the session
            // on every request and writes the cookie there instead.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
cd apps/admin && pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/supabase/client.ts apps/admin/src/lib/supabase/server.ts
git commit -m "feat: add admin Supabase browser and server clients"
```

---

### Task 14: Admin — validation schemas

**Files:**

- Create: `apps/admin/src/lib/validation.ts`
- Test: `apps/admin/src/lib/validation.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `emailSchema`, `passwordSchema`, `signInSchema`, `SignInInput` — consumed by Task 16's sign-in page.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/lib/validation.test.ts
import { describe, expect, it } from "vitest";

import { emailSchema, passwordSchema, signInSchema } from "./validation";

describe("emailSchema", () => {
  it("accepts a valid email", () => {
    expect(emailSchema.safeParse("a@b.com").success).toBe(true);
  });

  it("rejects an empty string", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });
});

describe("passwordSchema", () => {
  it("accepts an 8-character password", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(true);
  });

  it("rejects a 7-character password", () => {
    expect(passwordSchema.safeParse("1234567").success).toBe(false);
  });
});

describe("signInSchema", () => {
  it("accepts a valid email and password", () => {
    expect(signInSchema.safeParse({ email: "a@b.com", password: "12345678" }).success).toBe(true);
  });

  it("rejects a missing email", () => {
    expect(signInSchema.safeParse({ email: "", password: "12345678" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/admin && npx vitest run src/lib/validation.test.ts
```

Expected: FAIL with a module-not-found error for `./validation`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/lib/validation.ts
import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Email is required")
  .email("Enter a valid email address");

export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});
export type SignInInput = z.infer<typeof signInSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/admin && npx vitest run src/lib/validation.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Verify typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/validation.ts apps/admin/src/lib/validation.test.ts
git commit -m "feat: add admin sign-in form validation schema"
```

---

### Task 15: Admin — proxy (role-gated route protection)

**Files:**

- Create: `apps/admin/src/proxy.ts`
- Test: `apps/admin/src/proxy.test.ts`

**Interfaces:**

- Consumes: `@supabase/ssr`'s `createServerClient`; Next.js's `NextRequest`/`NextResponse` from `next/server`.
- Produces: the `proxy` function and `config.matcher` that gate every admin route except `/sign-in` and `/not-authorized` — this is the last task before the pages that need it (Task 16).

Next.js 16 has no stable first-party unit-testing helper installed for `proxy` beyond the experimental `next/experimental/testing/server` package (not installed, and out of scope to add). This task tests the underlying decision logic directly instead: `proxy.ts` is written so its routing decision is a small, pure, exported function (`decideRedirect`) that the `proxy` export wraps — the pure function is what's unit-tested.

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/proxy.test.ts
import { describe, expect, it } from "vitest";

import { decideRedirect } from "./proxy";

describe("decideRedirect", () => {
  it("redirects to /sign-in when there is no user", () => {
    expect(decideRedirect({ user: null, role: null })).toBe("/sign-in");
  });

  it("redirects to /not-authorized when the user is not an admin", () => {
    expect(decideRedirect({ user: { id: "user-1" }, role: "listener" })).toBe("/not-authorized");
  });

  it("redirects to /not-authorized when the profile role could not be read", () => {
    expect(decideRedirect({ user: { id: "user-1" }, role: null })).toBe("/not-authorized");
  });

  it("allows the request through when the user is an admin", () => {
    expect(decideRedirect({ user: { id: "user-1" }, role: "admin" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/admin && npx vitest run src/proxy.test.ts
```

Expected: FAIL with a module-not-found error for `./proxy`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/proxy.ts
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

export function decideRedirect(input: {
  user: { id: string } | null;
  role: string | null;
}): "/sign-in" | "/not-authorized" | null {
  if (!input.user) {
    return "/sign-in";
  }
  if (input.role !== "admin") {
    return "/not-authorized";
  }
  return null;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let role: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    role = profile?.role ?? null;
  }

  const redirectTo = decideRedirect({ user, role });
  if (redirectTo) {
    return NextResponse.redirect(new URL(redirectTo, request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!sign-in|not-authorized|_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/admin && npx vitest run src/proxy.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Verify typecheck and lint**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/proxy.ts apps/admin/src/proxy.test.ts
git commit -m "feat: add admin proxy enforcing session + admin-role gate on all routes"
```

---

### Task 16: Admin — Sign In and Not Authorized pages

**Files:**

- Create: `apps/admin/src/app/sign-in/page.tsx`
- Create: `apps/admin/src/app/not-authorized/page.tsx`

**Interfaces:**

- Consumes: `createClient` (browser, Task 13), `signInSchema`/`SignInInput` (Task 14).
- Produces: `/sign-in` and `/not-authorized`, the two routes Task 15's `proxy.ts` redirects to.

No unit tests — full page rendering is out of this plan's testing scope (same reasoning as the mobile screens); verified by typecheck/lint.

- [ ] **Step 1: Write the sign-in page**

```tsx
// apps/admin/src/app/sign-in/page.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { createClient } from "@/lib/supabase/client";
import { type SignInInput, signInSchema } from "@/lib/validation";

export default function SignInPage() {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: SignInInput) => {
    setApiError(undefined);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setApiError(error.message);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <form onSubmit={handleSubmit(onSubmit)} className="flex w-full max-w-sm flex-col gap-3">
        <h1 className="text-xl font-semibold">Admin Sign In</h1>

        <input
          {...register("email")}
          type="email"
          placeholder="Email"
          autoCapitalize="none"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {errors.email && <p className="text-sm text-red-600">{errors.email.message}</p>}

        <input
          {...register("password")}
          type="password"
          placeholder="Password"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {errors.password && <p className="text-sm text-red-600">{errors.password.message}</p>}
        {apiError && <p className="text-sm text-red-600">{apiError}</p>}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-[#1F3B2C] px-3 py-2 text-white disabled:opacity-50"
        >
          {isSubmitting ? "Signing In…" : "Sign In"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Write the not-authorized page**

```tsx
// apps/admin/src/app/not-authorized/page.tsx
"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export default function NotAuthorizedPage() {
  const router = useRouter();

  const handleBackToSignIn = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
  };

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Not Authorized</h1>
      <p>This account doesn't have admin access to Village Fireside.</p>
      <button onClick={handleBackToSignIn} className="rounded bg-[#1F3B2C] px-3 py-2 text-white">
        Back to Sign In
      </button>
    </main>
  );
}
```

- [ ] **Step 3: Verify typecheck and lint**

```bash
cd apps/admin && pnpm typecheck && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/app/sign-in apps/admin/src/app/not-authorized
git commit -m "feat: add admin sign-in and not-authorized pages"
```

---

### Task 17: Documentation (`docs/auth.md`)

**Files:**

- Create: `docs/auth.md`

**Interfaces:**

- Consumes: the full auth architecture from Tasks 1-16 (this task only documents it).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write `docs/auth.md`**

````markdown
# Authentication

## Mobile (`apps/mobile`)

Auth state lives in a zustand store (`src/stores/auth-store.ts`): `session`,
`guestMode`, `passwordRecovery`, and `loading`. A single hook,
`useAuthListener` (mounted once, in the root layout), is the only writer to
`session`/`loading` — it subscribes to `supabase.auth.onAuthStateChange` and
also flips `passwordRecovery` to `true` when Supabase fires a
`PASSWORD_RECOVERY` event (via the `resetPasswordForEmail` deep-link flow).
No screen calls `supabase.auth.getSession()` directly; they all read the
store.

Routing is two Expo Router groups: `(auth)` (Welcome, Sign In, Sign Up,
Phone Sign In, OTP Verify, Forgot Password, Reset Password) and `(app)` (a
placeholder authenticated screen for now — Prompt 6 replaces it with the
real tab shell). The root layout renders a `<Redirect>` to `(auth)/welcome`
when there's no session and no guest mode, or to `(app)` when either is
true.

Sessions persist through `expo-secure-store`, via a custom adapter
(`src/lib/secure-store-adapter.ts`) that transparently chunks values above
`expo-secure-store`'s per-key size ceiling — nothing else in the app needs
to know this happens.

### Guest-mode gate primitive

`useRequireAuth()` (`src/hooks/use-require-auth.ts`) returns a
`requireAuth(action)` wrapper: if signed in, it calls `action()`
immediately; if in guest mode, it opens `<SignInPromptSheet>`
(`src/components/sign-in-prompt-sheet.tsx`) instead. As of this prompt,
nothing calls it yet — no gated feature exists. Later prompts adopt it at
their own gated actions, for example:

```tsx
const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();

<Pressable onPress={() => requireAuth(() => addToFavorites(episodeId))}>
  <ThemedText>♡ Favorite</ThemedText>
</Pressable>

<SignInPromptSheet
  visible={promptVisible}
  onDismiss={dismissPrompt}
  onSignIn={() => router.push('/sign-in')}
  onSignUp={() => router.push('/sign-up')}
/>
```

## Admin (`apps/admin`)

`@supabase/ssr`'s standard browser/server client split
(`src/lib/supabase/client.ts`, `src/lib/supabase/server.ts`).

Route protection is `src/proxy.ts` — **not** `middleware.ts`: Next.js 16
deprecated and renamed the `middleware` file convention to `proxy`. It runs
on every route except `/sign-in`, `/not-authorized`, and static assets
(`config.matcher`), and does two things: (1) `supabase.auth.getUser()`,
refreshing the session cookie as a side effect — no user redirects to
`/sign-in`; (2) a `profiles.role` lookup for the authenticated user — any
role other than `'admin'` redirects to `/not-authorized`. The routing
decision itself is the small, pure, separately-tested `decideRedirect()`
function; `proxy()` wraps it with the actual Supabase calls.

No self-serve admin sign-up exists — admin accounts are provisioned
manually.

### Creating the first admin user

1. Sign up normally (through the mobile app, or directly in the Supabase
   dashboard's Authentication tab) to create an `auth.users` row — this
   also creates the matching `profiles` row via the `handle_new_user()`
   trigger.
2. In the Supabase SQL editor, promote that profile to admin:

   ```sql
   update profiles set role = 'admin' where id = '<user-uuid-from-auth.users>';
   ```

3. That account can now sign in at `/sign-in` in the admin app.
````

- [ ] **Step 2: Verify the doc covers the required points**

```bash
python3 - <<'PY'
doc = open("docs/auth.md").read()
assert "useAuthListener" in doc
assert "useRequireAuth" in doc
assert "passwordRecovery" in doc
assert "proxy.ts" in doc and "middleware.ts" in doc, "must explain the Next.js 16 rename"
assert "decideRedirect" in doc
assert "update profiles set role = 'admin'" in doc, "must include the admin-promotion SQL snippet"
print("OK: docs/auth.md covers store/listener, gate primitive, proxy rename, and admin-promotion SQL")
PY
```

Expected: `OK: docs/auth.md covers store/listener, gate primitive, proxy rename, and admin-promotion SQL`

- [ ] **Step 3: Commit**

```bash
git add docs/auth.md
git commit -m "docs: document mobile and admin authentication architecture"
```

---

## Verification (whole plan)

- `pnpm typecheck` and `pnpm lint` pass across the whole workspace.
- `pnpm test` (or `pnpm --filter mobile test` / `pnpm --filter admin test`) passes: phone formatting (5 tests), mobile validation (18 tests), secure-store adapter (5 tests), `useRequireAuth` (4 tests), admin validation (6 tests), `decideRedirect` (4 tests) — 42 tests total, all green.
- The migration file passes its structural check and doesn't touch the existing trigger definition.
- No `middleware.ts` file exists anywhere in `apps/admin` — only `proxy.ts`.
- `git log --oneline` shows 17 new commits, one per task.
- Applying the migration file by hand to the real Supabase project (after Prompts 2/3/3B/4's files), setting real `.env` values in both apps from their `.env.example` templates, and running `expo start` / `pnpm dev` against that live project to click through sign-up, sign-in, phone OTP, guest mode, forgot/reset password, and the admin sign-in + role gate, is the authoritative end-to-end test — out of this plan's scope, per the established no-Docker/no-local-Supabase convention.
