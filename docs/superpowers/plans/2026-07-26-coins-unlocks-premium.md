# Coins, Unlocks & Premium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full monetization for the mobile app per `docs/PROMPT_PACK.md`'s Prompt 9 — a real Unlock Sheet, an atomic server-side coin-unlock flow, RevenueCat-powered coin-pack/premium purchases, a webhook that credits coins or sets premium status, and the two fairness rules (coins never expire; unlocked episodes survive a premium lapse) enforced structurally and documented.

**Architecture:** All balance math happens in one Postgres function (`unlock_episode`) called only by the service role, wrapped by a new `unlock-episode` edge function that mirrors `get-episode-audio`'s existing JWT-verify-then-service-role pattern exactly. RevenueCat purchase events land on a `revenuecat-webhook` edge function that verifies an HMAC signature and maps `event.type` + `product_id` to a coin credit or a premium-status change, using a new `app_settings` table as the data-driven product→behavior mapping (not a hardcoded switch). The mobile app never computes a price or a balance change itself — it only ever displays what the store/RevenueCat SDK reports and what `profiles` (kept current by the webhook) already says.

**Tech Stack:** `react-native-purchases` (RevenueCat's React Native SDK), the existing Supabase/Postgres/Deno-edge-function stack, existing Zustand + TanStack Query + Supabase mobile stack.

## Global Constraints

- **RevenueCat/App Store/Play Store accounts do not exist yet for this project.** Every product identifier used in code (`coins_100`, `coins_500`, `coins_1200`, `premium_monthly`) and every env var (`EXPO_PUBLIC_REVENUECAT_IOS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`) is a placeholder, following the exact pattern `apps/mobile/.env.example` already uses for Supabase. Nothing in this plan blocks on external account creation; `docs/monetization.md` (Task 9) documents exactly what to configure and where the real values go.
- **Testing bar, corrected from the design spec:** this repo has zero existing test infrastructure for `supabase/functions/*` (Deno edge functions) — `get-episode-audio` (Prompt 4) has no automated tests either, only code review. This plan follows that same precedent: edge function logic (the Postgres function's branches, the webhook's event-mapping, HMAC verification) is written for clarity and is review-verified, not unit-tested. The one piece of new logic that genuinely is testable under the existing Jest setup — the mobile-side `unlock-episode.ts` wrapper's HTTP-response-to-result mapping — gets real tests, following `resolve-episode-source.test.ts`'s exact established pattern. `pnpm typecheck`/`pnpm lint` are the bar for every other task.
- **Migrations are applied by hand via the Supabase Studio SQL editor** (existing project convention, see `docs/schema.md`) — no local Supabase instance or migration runner exists in this environment. Tasks that add a migration only need to create the file.
- A Dev Client rebuild is required after adding `react-native-purchases` (any new native module addition requires this, config plugin or not) — this is an infrastructure/device step outside this environment's scope, not a coding task in this plan.
- `unlocks` rows and `is_premium`/`premium_expires_at` are never touched by anything except: `unlock_episode` (unlocks), and the webhook (premium fields). Nothing in any task should introduce a second write path to these fields — that is precisely what keeps the two fairness rules true.
- Coin-pack refunds/chargebacks are explicitly out of scope for this plan (Prompt 16's "compensating rows (refund type)" job) — a `CANCELLATION` event on a coin-pack (non-subscription) product is deliberately ignored, not reversed. This is a disclosed scope boundary, not an oversight; Task 6's webhook code and Task 9's docs both say so explicitly.

---

### Task 1: `app_settings` table

**Files:**

- Create: `supabase/migrations/20260726120000_app_settings.sql`
- Modify: `docs/schema.md`
- Modify: `docs/rls-policies.md`

**Interfaces:**

- Produces: `app_settings(key text primary key, value jsonb, updated_at timestamptz)`, seeded with `default_free_episode_count`, `coin_pack_products`, `premium_product_id` — consumed by Task 6's webhook (`coin_pack_products`, `premium_product_id`) and documented for Prompt 14's future consumption (`default_free_episode_count`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260726120000_app_settings.sql

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

create policy app_settings_select_anyone
  on app_settings for select
  using (true);

create policy app_settings_admin_all
  on app_settings for all
  using (is_admin())
  with check (is_admin());

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

insert into app_settings (key, value) values
  ('default_free_episode_count', '3'),
  ('coin_pack_products', '{"coins_100": 100, "coins_500": 500, "coins_1200": 1200}'),
  ('premium_product_id', '"premium_monthly"');
```

- [ ] **Step 2: Document the table in `docs/schema.md`**

Add this section immediately after the existing `## plays` section (end of file):

```markdown
### `app_settings`

A generic key/value config table for tunable values that don't warrant
their own column or table — e.g. the default number of free episodes
per series, and the product-identifier-to-behavior mappings the
`revenuecat-webhook` edge function reads.

| Column       | Type              | Notes                                                     |
| ------------ | ----------------- | --------------------------------------------------------- |
| `key`        | `text`, PK        |                                                           |
| `value`      | `jsonb`, not null | Shape depends on the key — see the seeded rows below.     |
| `updated_at` | `timestamptz`     | Auto-maintained by the shared `set_updated_at()` trigger. |

Publicly readable (like published content) so the mobile app can read
tunables like `default_free_episode_count` without an admin session;
writes are admin-only.

Seeded rows:

| `key`                        | `value`                                                    | Used by                                                                                             |
| ---------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `default_free_episode_count` | `3`                                                        | Not yet consumed by any code — Prompt 14's admin episode-creation UI will read this when it exists. |
| `coin_pack_products`         | `{"coins_100": 100, "coins_500": 500, "coins_1200": 1200}` | `revenuecat-webhook`, mapping a RevenueCat coin-pack `product_id` to a coin amount.                 |
| `premium_product_id`         | `"premium_monthly"`                                        | `revenuecat-webhook`, identifying which `product_id` is the premium subscription.                   |
```

Also add `app_settings` to the existing "`updated_at` maintenance" section's list of tables with the shared trigger (currently reads "`profiles`, `destinations`, `series`, `episodes`, and `listening_progress`").

- [ ] **Step 3: Document the RLS policy in `docs/rls-policies.md`**

Add a new section, in table order after `cultural_groups, series_cultural_groups, contributor_cultural_groups`:

```markdown
### `app_settings`

- **Public select** (`app_settings_select_anyone`): `using (true)` —
  anyone, including unauthenticated requests, can read every row. This
  is a config table, not user data; nothing in it is sensitive, and the
  mobile app needs to read tunables like `default_free_episode_count`
  without an admin session.
- **Admin full access** (`app_settings_admin_all`): same `is_admin()`
  pattern as the content tables.
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260726120000_app_settings.sql docs/schema.md docs/rls-policies.md
git commit -m "Prompt 9: add app_settings config table"
```

---

### Task 2: Server-side atomic unlock — Postgres function + edge function

**Files:**

- Create: `supabase/migrations/20260726120100_unlock_episode_function.sql`
- Create: `supabase/functions/unlock-episode/index.ts`
- Modify: `docs/schema.md`

**Interfaces:**

- Produces: `unlock_episode(p_user_id uuid, p_episode_id uuid) returns jsonb` — a `{result: "unlocked" | "already_unlocked" | "insufficient_coins" | "not_coin_gated" | "not_found", ...}` shape.
- Produces: `unlock-episode` edge function — `POST { episode_id }` with an `Authorization: Bearer <jwt>` header, returning `200 {ok: true}` / `402 {error: "insufficient_coins", balance, price}` / `400 {error: "not_coin_gated"}` / `404 {error: "not_found"}` / `401 {error: "unauthorized"}` — consumed by Task 3's mobile wrapper.

- [ ] **Step 1: Write the Postgres function**

```sql
-- supabase/migrations/20260726120100_unlock_episode_function.sql

create or replace function unlock_episode(p_user_id uuid, p_episode_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_episode record;
  v_balance bigint;
  v_already_unlocked boolean;
begin
  select access_tier, coin_price into v_episode
  from episodes
  where id = p_episode_id and status = 'published';

  if not found then
    return jsonb_build_object('result', 'not_found');
  end if;

  if v_episode.access_tier <> 'coins' then
    return jsonb_build_object('result', 'not_coin_gated');
  end if;

  select exists(
    select 1 from unlocks where user_id = p_user_id and episode_id = p_episode_id
  ) into v_already_unlocked;

  if v_already_unlocked then
    return jsonb_build_object('result', 'already_unlocked');
  end if;

  select coin_balance into v_balance
  from profiles
  where id = p_user_id
  for update;

  if v_balance < v_episode.coin_price then
    return jsonb_build_object(
      'result', 'insufficient_coins',
      'balance', v_balance,
      'price', v_episode.coin_price
    );
  end if;

  update profiles set coin_balance = coin_balance - v_episode.coin_price where id = p_user_id;

  insert into unlocks (user_id, episode_id) values (p_user_id, p_episode_id);

  insert into transactions (user_id, transaction_type, amount, coins_delta, episode_id)
  values (p_user_id, 'episode_unlock', v_episode.coin_price, -v_episode.coin_price, p_episode_id);

  return jsonb_build_object('result', 'unlocked');
end;
$$;
```

`SELECT ... FOR UPDATE` on the profile row makes the check-then-decrement
race-free under concurrent calls — a second call's `SELECT` blocks until
the first transaction commits, then re-reads the already-decremented
balance. The already-unlocked short-circuit runs before acquiring that
lock (a cheap read), so a retried request after a successful unlock
never re-charges. This function is meant to be called only by the
service role (same trust boundary `plays`/`unlocks`/`transactions`
writes already use) — it takes `p_user_id` explicitly rather than using
`auth.uid()`, since the edge function below authenticates the caller
itself and then acts via the service-role client.

- [ ] **Step 2: Document the function in `docs/schema.md`**

Add this section right after the new `app_settings` section from Task 1:

```markdown
## `unlock_episode` function

`unlock_episode(p_user_id uuid, p_episode_id uuid) returns jsonb` is the
only path by which `profiles.coin_balance` is ever decremented. It runs
the balance check, the decrement, and the `unlocks`/`transactions`
inserts in one transaction (a `SELECT ... FOR UPDATE` on the profile row
makes concurrent calls for the same user race-free), and is called only
by the `unlock-episode` edge function using the service role — no
client ever calls it directly. Returns `{"result": "..."}` where
`result` is one of `unlocked`, `already_unlocked` (a no-op — no
re-charge), `insufficient_coins` (with `balance`/`price`),
`not_coin_gated` (the episode isn't `access_tier = 'coins'`), or
`not_found`.
```

- [ ] **Step 3: Write the edge function**

```ts
// supabase/functions/unlock-episode/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let episodeId: unknown;
  try {
    const body = await req.json();
    episodeId = body.episode_id;
  } catch {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  if (typeof episodeId !== "string" || !UUID_RE.test(episodeId)) {
    return jsonResponse({ error: "invalid_request" }, 400);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const supabaseService = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: userData, error: userError } = await supabaseAnon.auth.getUser(jwt);
    if (userError || !userData.user) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const { data, error } = await supabaseService.rpc("unlock_episode", {
      p_user_id: userData.user.id,
      p_episode_id: episodeId,
    });

    if (error) {
      throw error;
    }

    const result = (data as { result: string; balance?: number; price?: number }).result;

    switch (result) {
      case "unlocked":
      case "already_unlocked":
        return jsonResponse({ ok: true }, 200);
      case "insufficient_coins":
        return jsonResponse(
          {
            error: "insufficient_coins",
            balance: (data as { balance: number }).balance,
            price: (data as { price: number }).price,
          },
          402,
        );
      case "not_coin_gated":
        return jsonResponse({ error: "not_coin_gated" }, 400);
      case "not_found":
        return jsonResponse({ error: "not_found" }, 404);
      default:
        return jsonResponse({ error: "internal_error" }, 500);
    }
  } catch (err) {
    console.error("unlock-episode error:", err);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
```

This mirrors `supabase/functions/get-episode-audio/index.ts`'s exact
structure (anon client verifies the JWT, service client does the
privileged work, same CORS/UUID-validation/JSON-response helpers) —
read that file first if anything here is unclear, it's the established
template.

- [ ] **Step 4: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add supabase/migrations/20260726120100_unlock_episode_function.sql supabase/functions/unlock-episode/index.ts docs/schema.md
git commit -m "Prompt 9: add atomic unlock_episode function and unlock-episode edge function"
```

---

### Task 3: Mobile `unlock-episode` wrapper (TDD)

**Files:**

- Create: `apps/mobile/src/lib/unlock-episode.ts`
- Test: `apps/mobile/src/lib/unlock-episode.test.ts`

**Interfaces:**

- Consumes: `supabase` from `@/lib/supabase`, `FunctionsHttpError` from `@supabase/supabase-js`.
- Produces: `unlockEpisode(episodeId: string): Promise<UnlockEpisodeResult>` — consumed by Task 7's real Unlock Sheet.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/lib/unlock-episode.test.ts
import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

import { unlockEpisode } from "./unlock-episode";

jest.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const mockInvoke = supabase.functions.invoke as jest.Mock;

describe("unlockEpisode", () => {
  it("maps a 200 { ok: true } response to unlocked", async () => {
    mockInvoke.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await unlockEpisode("ep-1")).toEqual({ type: "unlocked" });
  });

  it("maps a 402 insufficient_coins response to insufficient_coins with balance/price", async () => {
    const response = new Response(
      JSON.stringify({ error: "insufficient_coins", balance: 20, price: 50 }),
      { status: 402 },
    );
    mockInvoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(response) });
    expect(await unlockEpisode("ep-2")).toEqual({
      type: "insufficient_coins",
      balance: 20,
      price: 50,
    });
  });

  it("maps a 400 response to not_coin_gated", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 400 })),
    });
    expect(await unlockEpisode("ep-3")).toEqual({ type: "not_coin_gated" });
  });

  it("maps a 404 response to not_found", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 404 })),
    });
    expect(await unlockEpisode("ep-4")).toEqual({ type: "not_found" });
  });

  it("maps a 401 response to unauthorized", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 401 })),
    });
    expect(await unlockEpisode("ep-5")).toEqual({ type: "unauthorized" });
  });

  it("maps a 500 response to error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response(null, { status: 500 })),
    });
    expect(await unlockEpisode("ep-6")).toEqual({ type: "error" });
  });

  it("maps a network/relay error (no FunctionsHttpError) to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: null, error: new Error("network down") });
    expect(await unlockEpisode("ep-7")).toEqual({ type: "error" });
  });

  it("maps a 200 response missing ok:true to error", async () => {
    mockInvoke.mockResolvedValueOnce({ data: {}, error: null });
    expect(await unlockEpisode("ep-8")).toEqual({ type: "error" });
  });

  it("defaults balance/price to 0 if the 402 body is malformed", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(new Response("not json", { status: 402 })),
    });
    expect(await unlockEpisode("ep-9")).toEqual({
      type: "insufficient_coins",
      balance: 0,
      price: 0,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/mobile && npx jest unlock-episode
```

Expected: FAIL — `Cannot find module './unlock-episode'`.

- [ ] **Step 3: Implement the module**

```ts
// apps/mobile/src/lib/unlock-episode.ts
import { FunctionsHttpError } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

export type UnlockEpisodeResult =
  | { type: "unlocked" }
  | { type: "insufficient_coins"; balance: number; price: number }
  | { type: "not_coin_gated" }
  | { type: "not_found" }
  | { type: "unauthorized" }
  | { type: "error" };

export async function unlockEpisode(episodeId: string): Promise<UnlockEpisodeResult> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean }>("unlock-episode", {
    body: { episode_id: episodeId },
  });

  if (error) {
    if (error instanceof FunctionsHttpError) {
      const status = error.context.status;
      if (status === 402) {
        const body = await error.context.json().catch(() => null);
        return {
          type: "insufficient_coins",
          balance: typeof body?.balance === "number" ? body.balance : 0,
          price: typeof body?.price === "number" ? body.price : 0,
        };
      }
      if (status === 400) {
        return { type: "not_coin_gated" };
      }
      if (status === 404) {
        return { type: "not_found" };
      }
      if (status === 401) {
        return { type: "unauthorized" };
      }
    }
    return { type: "error" };
  }

  if (!data?.ok) {
    return { type: "error" };
  }

  return { type: "unlocked" };
}
```

`error.context.json()` is safe to call here (not already consumed):
`FunctionsHttpError` is thrown by `@supabase/functions-js` immediately
on a non-2xx response, before the library reads the body itself — this
was verified directly against the installed package's source
(`FunctionsClient.js`) during Prompt 8's equivalent seam
(`resolve-episode-source.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/mobile && npx jest unlock-episode
```

Expected: PASS, all 9 cases.

- [ ] **Step 5: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/lib/unlock-episode.ts apps/mobile/src/lib/unlock-episode.test.ts
git commit -m "Prompt 9: add mobile unlock-episode wrapper"
```

---

### Task 4: RevenueCat SDK setup

**Files:**

- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/.env.example`
- Create: `apps/mobile/src/hooks/use-configure-purchases.ts`
- Create: `apps/mobile/src/hooks/use-sync-purchases-identity.ts`
- Modify: `apps/mobile/src/app/_layout.tsx`

**Interfaces:**

- Produces: `useConfigurePurchases()`, `useSyncPurchasesIdentity()` — both called once from the root layout. Consumed by Tasks 6/7 indirectly (they call `Purchases.getOfferings()`/`purchasePackage()`/`restorePurchases()` directly, which only work once these two hooks have run).

- [ ] **Step 1: Install the SDK**

```bash
cd apps/mobile && npx expo install react-native-purchases
```

Expected: `package.json` gains a `react-native-purchases` entry under
`dependencies`. There is no Expo config plugin for this package
(verified against RevenueCat's current Expo documentation) — it
autolinks like any other native module; no `app.json` change is needed.

- [ ] **Step 2: Add placeholder env vars**

In `apps/mobile/.env.example`, add:

```
# Placeholders until a RevenueCat project + App Store Connect/Play Console
# products exist — see docs/monetization.md for what to configure.
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=your-revenuecat-ios-api-key
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=your-revenuecat-android-api-key
```

- [ ] **Step 3: Write the configure hook**

```ts
// apps/mobile/src/hooks/use-configure-purchases.ts
import { useEffect } from "react";
import { Platform } from "react-native";
import Purchases from "react-native-purchases";

// Configures the RevenueCat SDK once, anonymously (RevenueCat assigns
// its own auto-generated anonymous id) — real user identity is synced
// separately by useSyncPurchasesIdentity once auth state is known.
export function useConfigurePurchases() {
  useEffect(() => {
    const apiKey =
      Platform.OS === "ios"
        ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
        : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
    if (!apiKey) {
      console.warn(`Missing RevenueCat API key for platform "${Platform.OS}"`);
      return;
    }
    Purchases.configure({ apiKey });
  }, []);
}
```

- [ ] **Step 4: Write the identity-sync hook**

```ts
// apps/mobile/src/hooks/use-sync-purchases-identity.ts
import { useEffect, useRef } from "react";
import Purchases from "react-native-purchases";

import { useAuthStore } from "@/stores/auth-store";

// Keeps RevenueCat's "App User ID" equal to our own Supabase user id, so
// revenuecat-webhook's app_user_id can be treated as profiles.id
// directly. Calling Purchases.logOut() while the SDK has never been
// logged in throws LOG_OUT_ANONYMOUS_USER_ERROR (verified against
// RevenueCat's current error-code list) — hasLoggedInRef guards against
// that, so a guest's cold start (the common case) never calls logOut().
export function useSyncPurchasesIdentity() {
  const loading = useAuthStore((state) => state.loading);
  const userId = useAuthStore((state) => state.session?.user.id ?? null);
  const hasLoggedInRef = useRef(false);

  useEffect(() => {
    if (loading) {
      return;
    }
    if (userId) {
      hasLoggedInRef.current = true;
      Purchases.logIn(userId).catch((error: unknown) => {
        console.warn("Purchases.logIn failed:", error);
      });
    } else if (hasLoggedInRef.current) {
      hasLoggedInRef.current = false;
      Purchases.logOut().catch((error: unknown) => {
        console.warn("Purchases.logOut failed:", error);
      });
    }
  }, [loading, userId]);
}
```

- [ ] **Step 5: Wire both into the root layout**

In `apps/mobile/src/app/_layout.tsx`, add the imports:

```ts
import { useConfigurePurchases } from "@/hooks/use-configure-purchases";
import { useSyncPurchasesIdentity } from "@/hooks/use-sync-purchases-identity";
```

And call them, in this order, right after the existing startup hooks:

```ts
useAuthListener();
useRecoveryLinkHandler();
useConfigureAudioMode();
useConfigurePurchases();
useSyncPurchasesIdentity();
```

(`useConfigurePurchases` before `useSyncPurchasesIdentity` so `Purchases.configure()` has run before any `logIn`/`logOut` call could fire — in practice `useSyncPurchasesIdentity`'s effect is a no-op until `loading` becomes `false`, well after the first render, so this ordering is a belt-and-suspenders correctness note more than a strict runtime requirement.)

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/package.json apps/mobile/pnpm-lock.yaml apps/mobile/.env.example apps/mobile/src/hooks/use-configure-purchases.ts apps/mobile/src/hooks/use-sync-purchases-identity.ts apps/mobile/src/app/_layout.tsx
git commit -m "Prompt 9: install react-native-purchases and wire RevenueCat identity sync"
```

If `apps/mobile/pnpm-lock.yaml` doesn't exist as a separate file (this is a pnpm workspace with one root lockfile), instead run `git status` after Step 1 to see exactly which lockfile path changed and add that path — the root `pnpm-lock.yaml` must be committed alongside `package.json`, the same lesson learned the hard way during Prompt 8's Task 1.

---

### Task 5: `revenuecat-webhook` edge function

**Files:**

- Create: `supabase/functions/revenuecat-webhook/index.ts`

**Interfaces:**

- Consumes: `app_settings` rows `coin_pack_products`/`premium_product_id` (Task 1).
- Produces: a webhook endpoint credited coins/premium status changes flow through — no other task consumes this function directly (it's the terminal end of the purchase flow), but Task 9's docs describe its configuration.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/revenuecat-webhook/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RevenueCatEvent = {
  type: string;
  app_user_id: string;
  product_id: string;
  id: string;
  expiration_at_ms: number | null;
};

type CoinPackMap = Record<string, number>;

type WebhookAction =
  | { action: "credit_coins"; coins: number }
  | { action: "set_premium"; expiresAtMs: number }
  | { action: "expire_premium" }
  | { action: "log_only" }
  | { action: "none" };

// Pure and dependency-free so it's easy to read and reason about
// independently of the HTTP/DB plumbing around it, even without an
// automated test runner for this workspace today.
export function mapEventToAction(
  event: RevenueCatEvent,
  coinPackProducts: CoinPackMap,
  premiumProductId: string,
): WebhookAction {
  if (event.type === "NON_RENEWING_PURCHASE") {
    const coins = coinPackProducts[event.product_id];
    return coins ? { action: "credit_coins", coins } : { action: "none" };
  }

  const isPremiumProduct = event.product_id === premiumProductId;

  if (
    isPremiumProduct &&
    ["INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE"].includes(event.type) &&
    event.expiration_at_ms !== null
  ) {
    return { action: "set_premium", expiresAtMs: event.expiration_at_ms };
  }

  // Not CANCELLATION: cancelling only stops future renewal, access
  // continues until the subscription actually expires.
  if (isPremiumProduct && event.type === "EXPIRATION") {
    return { action: "expire_premium" };
  }

  // Logged for observability but no state change — cancelling a coin
  // pack (a refund) is deliberately not reversed here; see this plan's
  // Global Constraints.
  if (isPremiumProduct && (event.type === "CANCELLATION" || event.type === "BILLING_ISSUE")) {
    return { action: "log_only" };
  }

  return { action: "none" };
}

async function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): Promise<boolean> {
  if (!signatureHeader) {
    return false;
  }
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => part.split("=") as [string, string]),
  );
  const timestamp = parts["t"];
  const providedSignature = parts["v1"];
  if (!timestamp || !providedSignature) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const computedSignature = Array.from(new Uint8Array(signatureBytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (computedSignature.length !== providedSignature.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < computedSignature.length; i++) {
    diff |= computedSignature.charCodeAt(i) ^ providedSignature.charCodeAt(i);
  }
  return diff === 0;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const secret = Deno.env.get("REVENUECAT_WEBHOOK_SECRET")!;
  const isValid = await verifySignature(
    rawBody,
    req.headers.get("X-RevenueCat-Webhook-Signature"),
    secret,
  );
  if (!isValid) {
    return new Response(JSON.stringify({ error: "invalid_signature" }), { status: 401 });
  }

  let payload: { event: RevenueCatEvent };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "invalid_request" }), { status: 400 });
  }

  const event = payload.event;

  if (event.type === "TEST") {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { data: coinSettingsRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "coin_pack_products")
      .maybeSingle();
    const { data: premiumSettingsRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "premium_product_id")
      .maybeSingle();

    const coinPackProducts = (coinSettingsRow?.value as CoinPackMap | undefined) ?? {};
    const premiumProductId = (premiumSettingsRow?.value as string | undefined) ?? "";

    const action = mapEventToAction(event, coinPackProducts, premiumProductId);

    if (action.action === "credit_coins") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("coin_balance")
        .eq("id", event.app_user_id)
        .maybeSingle();
      if (profile) {
        await supabase
          .from("profiles")
          .update({ coin_balance: profile.coin_balance + action.coins })
          .eq("id", event.app_user_id);
      }
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "coin_purchase",
        amount: action.coins,
        coins_delta: action.coins,
        reference: event.id,
      });
    } else if (action.action === "set_premium") {
      await supabase
        .from("profiles")
        .update({
          is_premium: true,
          premium_expires_at: new Date(action.expiresAtMs).toISOString(),
        })
        .eq("id", event.app_user_id);
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
    } else if (action.action === "expire_premium") {
      await supabase.from("profiles").update({ is_premium: false }).eq("id", event.app_user_id);
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
    } else if (action.action === "log_only") {
      await supabase.from("transactions").insert({
        user_id: event.app_user_id,
        transaction_type: "subscription",
        amount: 0,
        reference: event.id,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("revenuecat-webhook error:", err);
    return new Response(JSON.stringify({ error: "internal_error" }), { status: 500 });
  }
});
```

The HMAC scheme (`X-RevenueCat-Webhook-Signature: t=<unix_ts>,v1=<hex>`,
computed over `"{timestamp}.{raw_body}"`) and the webhook's JSON
envelope (`{"event": {...}, "api_version": "1.0"}`) were both verified
against RevenueCat's current webhook documentation before writing this
task — do not restructure the payload parsing or signature format
without re-checking those docs, since a subtly wrong HMAC
implementation fails closed (rejects everything) rather than open, so
it fails loudly during testing rather than silently accepting forged
requests.

- [ ] **Step 2: Typecheck and commit**

Deno edge functions are outside the `tsc`/`eslint` project this repo's
`pnpm typecheck`/`pnpm lint` cover (same as `get-episode-audio` and
`unlock-episode`) — there is nothing to run here beyond a read-through.
Confirm the file has no syntax errors by eye, then commit:

```bash
git add supabase/functions/revenuecat-webhook/index.ts
git commit -m "Prompt 9: add revenuecat-webhook edge function"
```

---

### Task 6: `useProfile` hook + coin purchase screen

**Files:**

- Create: `apps/mobile/src/hooks/queries/use-profile.ts`
- Create: `apps/mobile/src/app/(app)/coins.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Produces: `useProfile()` returning `{displayName, coinBalance, isPremium, premiumExpiresAt}`, `profileQueryKey(userId)` — consumed by Task 8's Profile screen.
- Produces: the `/coins` route — consumed by Task 7's real Unlock Sheet and Task 8's Profile screen (both `router.push("/coins")`).

- [ ] **Step 1: Implement `useProfile`**

```ts
// apps/mobile/src/hooks/queries/use-profile.ts
import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";

export type ProfileSummary = {
  displayName: string;
  coinBalance: number;
  isPremium: boolean;
  premiumExpiresAt: string | null;
};

export function profileQueryKey(userId: string | null) {
  return ["profile", userId] as const;
}

export function useProfile() {
  const session = useAuthStore((state) => state.session);

  return useQuery({
    queryKey: profileQueryKey(session?.user.id ?? null),
    enabled: session !== null,
    queryFn: async (): Promise<ProfileSummary> => {
      if (!session) {
        throw new Error("Cannot fetch profile without a signed-in session");
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("display_name, coin_balance, is_premium, premium_expires_at")
        .eq("id", session.user.id)
        .single();
      if (error) {
        throw error;
      }
      return {
        displayName: data.display_name,
        coinBalance: data.coin_balance,
        isPremium: data.is_premium,
        premiumExpiresAt: data.premium_expires_at,
      };
    },
  });
}
```

- [ ] **Step 2: Implement the coin purchase screen**

```tsx
// apps/mobile/src/app/(app)/coins.tsx
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Purchases, { type PurchasesPackage } from "react-native-purchases";

import { ThemedText } from "@/components/themed-text";
import { BackButton } from "@/components/ui/back-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Spacing } from "@/constants/theme";

export default function CoinsScreen() {
  const queryClient = useQueryClient();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Purchases.getOfferings()
      .then((offerings) => {
        if (!cancelled) {
          setPackages(offerings.current?.availablePackages ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePurchase = async (pkg: PurchasesPackage) => {
    setPurchasingId(pkg.identifier);
    try {
      await Purchases.purchasePackage(pkg);
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      Alert.alert("Success", "Your purchase is complete.");
    } catch (error) {
      const purchasesError = error as { userCancelled?: boolean };
      if (!purchasesError.userCancelled) {
        Alert.alert("Purchase failed", "Something went wrong. Please try again.");
      }
    } finally {
      setPurchasingId(null);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      await Purchases.restorePurchases();
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      Alert.alert("Restored", "Your purchases have been restored.");
    } catch {
      Alert.alert("Restore failed", "Something went wrong. Please try again.");
    } finally {
      setRestoring(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <BackButton />
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="title">Coins & Premium</ThemedText>

        {loadError ? (
          <EmptyState title="Couldn't load products" body="Check your connection and try again." />
        ) : packages === null ? (
          <Skeleton width="100%" height={200} />
        ) : packages.length === 0 ? (
          <EmptyState
            title="No products available"
            body="Products haven't been configured yet — check back soon."
          />
        ) : (
          packages.map((pkg) => (
            <Card key={pkg.identifier} style={styles.productCard}>
              <ThemedText type="smallBold">{pkg.product.title}</ThemedText>
              <ThemedText type="default" themeColor="textSecondary">
                {pkg.product.description}
              </ThemedText>
              <Button
                label={pkg.product.priceString}
                onPress={() => void handlePurchase(pkg)}
                loading={purchasingId === pkg.identifier}
                disabled={purchasingId !== null}
              />
            </Card>
          ))
        )}

        <Pressable onPress={() => void handleRestore()} disabled={restoring}>
          <ThemedText type="linkPrimary">
            {restoring ? "Restoring…" : "Restore Purchases"}
          </ThemedText>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  productCard: {
    gap: Spacing.two,
  },
});
```

`queryClient.invalidateQueries({ queryKey: ["profile"] })` matches
against every query whose key starts with `["profile"]` — including
`profileQueryKey(userId)`'s `["profile", userId]` — by TanStack Query's
default partial-key matching, so this works without this screen needing
to know the current user id itself.

`pkg.product.priceString`/`title`/`description`/`identifier` are real
fields on `PurchasesStoreProduct` (verified directly against the
installed SDK's type-generating package,
`@revenuecat/purchases-typescript-internal`, before writing this task)
— there is no hardcoded currency amount anywhere in this file.

- [ ] **Step 3: Register the route**

In `apps/mobile/src/app/(app)/_layout.tsx`, add a new `Stack.Screen`
entry alongside the existing ones:

```tsx
<Stack.Screen name="coins" options={{ headerShown: false }} />
```

- [ ] **Step 4: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/hooks/queries/use-profile.ts "apps/mobile/src/app/(app)/coins.tsx" "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 9: add useProfile hook and coin purchase screen"
```

---

### Task 7: Real Unlock Sheet

**Files:**

- Create: `apps/mobile/src/components/unlock-sheet.tsx`
- Delete: `apps/mobile/src/components/unlock-sheet-stub.tsx`
- Modify: `apps/mobile/src/app/(app)/_layout.tsx`

**Interfaces:**

- Consumes: `usePlayerStore`'s `lockedEpisode`/`dismissLockedEpisode` (unchanged trigger from Prompt 8), `unlockEpisode` from `@/lib/unlock-episode` (Task 3), `useRequireAuth`, `SignInPromptSheet`, the `/coins` route (Task 6).

- [ ] **Step 1: Implement the real sheet**

```tsx
// apps/mobile/src/components/unlock-sheet.tsx
import { useRouter } from "expo-router";
import { Modal, Pressable, StyleSheet } from "react-native";

import { SignInPromptSheet } from "@/components/sign-in-prompt-sheet";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { Spacing } from "@/constants/theme";
import { useRequireAuth } from "@/hooks/use-require-auth";
import { unlockEpisode } from "@/lib/unlock-episode";
import { usePlayerStore } from "@/stores/player-store";

export function UnlockSheet() {
  const router = useRouter();
  const lockedEpisode = usePlayerStore((state) => state.lockedEpisode);
  const dismissLockedEpisode = usePlayerStore((state) => state.dismissLockedEpisode);
  const { requireAuth, promptVisible, dismissPrompt } = useRequireAuth();

  const handleUnlock = () => {
    if (!lockedEpisode) {
      return;
    }
    const episodeId = lockedEpisode.id;
    requireAuth(() => {
      unlockEpisode(episodeId)
        .then((result) => {
          if (result.type === "unlocked") {
            dismissLockedEpisode();
          } else if (result.type === "insufficient_coins") {
            dismissLockedEpisode();
            router.push("/coins");
          }
          // not_coin_gated/not_found/unauthorized/error: leave the sheet
          // open — these shouldn't happen for a row the UI already
          // gated on access_tier === "coins".
        })
        .catch(() => {});
    });
  };

  const handleGoPremium = () => {
    requireAuth(() => {
      dismissLockedEpisode();
      router.push("/coins");
    });
  };

  return (
    <>
      <Modal
        visible={lockedEpisode !== null}
        transparent
        animationType="slide"
        onRequestClose={dismissLockedEpisode}
      >
        <Pressable style={styles.backdrop} onPress={dismissLockedEpisode}>
          <ThemedView style={styles.sheet}>
            <ThemedText type="subtitle">{lockedEpisode?.title}</ThemedText>
            {lockedEpisode?.accessTier === "coins" ? (
              <>
                <ThemedText type="default" themeColor="textSecondary">
                  {lockedEpisode.coinPrice} coins
                </ThemedText>
                <Button
                  label={`Unlock for ${lockedEpisode.coinPrice} coins`}
                  onPress={handleUnlock}
                />
              </>
            ) : (
              <ThemedText type="default" themeColor="textSecondary">
                Premium episode
              </ThemedText>
            )}
            <Button label="Go Premium" variant="secondary" onPress={handleGoPremium} />
          </ThemedView>
        </Pressable>
      </Modal>
      <SignInPromptSheet
        visible={promptVisible}
        onDismiss={dismissPrompt}
        onSignIn={() => {
          dismissPrompt();
          router.push("/sign-in");
        }}
        onSignUp={() => {
          dismissPrompt();
          router.push("/sign-up");
        }}
      />
    </>
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
});
```

The coin-unlock option only renders for `accessTier === "coins"` — a
`premium`-tier episode has no coin price to offer, and the
`unlock_episode` Postgres function would reject a coin-unlock attempt
on it with `not_coin_gated` anyway. "Go Premium" always renders,
regardless of tier, since `get-episode-audio`'s existing access check
already grants access to any non-free episode once `is_premium` is
true.

- [ ] **Step 2: Delete the stub and update the layout**

```bash
git rm apps/mobile/src/components/unlock-sheet-stub.tsx
```

In `apps/mobile/src/app/(app)/_layout.tsx`, replace:

```ts
import { UnlockSheetStub } from "@/components/unlock-sheet-stub";
```

with:

```ts
import { UnlockSheet } from "@/components/unlock-sheet";
```

and replace `<UnlockSheetStub />` with `<UnlockSheet />` in the render
tree.

- [ ] **Step 3: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add apps/mobile/src/components/unlock-sheet.tsx "apps/mobile/src/app/(app)/_layout.tsx"
git commit -m "Prompt 9: replace stub Unlock Sheet with the real unlock/purchase flow"
```

---

### Task 8: Profile screen — coin balance, premium status, purchase entry points

**Files:**

- Modify: `apps/mobile/src/app/(app)/(tabs)/profile.tsx`

**Interfaces:**

- Consumes: `useProfile()` (Task 6).

- [ ] **Step 1: Rewrite the screen**

```tsx
// apps/mobile/src/app/(app)/(tabs)/profile.tsx
import { useRouter } from "expo-router";
import { StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/ui/section-header";
import { Spacing } from "@/constants/theme";
import { useProfile } from "@/hooks/queries/use-profile";
import { useAuthStore } from "@/stores/auth-store";

export default function ProfileScreen() {
  const router = useRouter();
  const guestMode = useAuthStore((state) => state.guestMode);
  const signOut = useAuthStore((state) => state.signOut);
  const profileQuery = useProfile();
  const profile = profileQuery.data;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <SectionHeader title="Profile" />
        <ThemedText type="default">
          {guestMode ? "Browsing as Guest" : `Signed in as ${profile?.displayName ?? "…"}`}
        </ThemedText>

        {!guestMode ? (
          <ThemedView style={styles.coinsSection}>
            <ThemedText type="smallBold">🪙 {profile?.coinBalance ?? 0} coins</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {profile?.isPremium
                ? profile.premiumExpiresAt
                  ? `Premium until ${new Date(profile.premiumExpiresAt).toLocaleDateString()}`
                  : "Premium"
                : "Not premium"}
            </ThemedText>
            <Button
              label={profile?.isPremium ? "Manage Premium" : "Buy Coins / Go Premium"}
              variant="secondary"
              onPress={() => router.push("/coins")}
            />
          </ThemedView>
        ) : null}

        <Button
          label={guestMode ? "Sign In" : "Sign Out"}
          variant="ghost"
          onPress={() => void signOut()}
        />
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
    padding: Spacing.four,
    gap: Spacing.three,
  },
  coinsSection: {
    gap: Spacing.one,
  },
});
```

This removes the screen's previous manual
`useEffect`/`useState`-driven `display_name` fetch, replacing it with
`useProfile()` — the same TanStack Query hook Task 6 built, so a
webhook-driven coin/premium change shows up on this screen's next
focus/refetch without a manual reload.

- [ ] **Step 2: Typecheck, lint, and commit**

```bash
pnpm typecheck && pnpm lint
git add "apps/mobile/src/app/(app)/(tabs)/profile.tsx"
git commit -m "Prompt 9: show coin balance and premium status on the Profile screen"
```

---

### Task 9: `docs/monetization.md`

**Files:**

- Create: `docs/monetization.md`

- [ ] **Step 1: Write the document**

```markdown
# Monetization

How coins, unlocks, and premium subscriptions work end to end, and how
to test the flow once real RevenueCat/App Store/Play Store accounts
exist.

## The flow

1. A user taps "Unlock for X coins" or "Go Premium" on a locked
   episode (the Unlock Sheet, `apps/mobile/src/components/unlock-sheet.tsx`).
2. **Coin unlock:** the mobile app calls the `unlock-episode` edge
   function, which verifies the caller's JWT and calls the
   `unlock_episode` Postgres function via the service role. That
   function is the only code path that ever decrements
   `profiles.coin_balance` — it checks the balance, decrements it, and
   inserts `unlocks`/`transactions` rows in one transaction (a
   `SELECT ... FOR UPDATE` row lock makes concurrent calls for the same
   user race-free). The client is never trusted with the balance math.
3. **Coin packs / premium purchases:** the mobile app calls
   `Purchases.purchasePackage(...)` (RevenueCat's SDK), which hands off
   to the App Store/Play Store's native purchase sheet. RevenueCat then
   sends a webhook to the `revenuecat-webhook` edge function, which
   verifies an HMAC signature and, based on the event, either credits
   coins (`NON_RENEWING_PURCHASE`) or sets `is_premium`/
   `premium_expires_at` (`INITIAL_PURCHASE`/`RENEWAL`/etc.). The mobile
   app never credits coins or sets premium status itself — only the
   webhook does, after the purchase is already verified by the store
   and RevenueCat.
4. The Profile screen and the coin purchase screen both read
   `profiles.coin_balance`/`is_premium`/`premium_expires_at` via
   `useProfile()` (TanStack Query), so a webhook-driven change shows up
   automatically on the next screen focus/refetch.

## Fairness rules

- **Coins never expire.** Nothing in the schema or in
  `revenuecat-webhook` ever decrements `coin_balance` on a timer or on
  any event other than a successful `unlock_episode` call — there is no
  decay path to introduce by accident.
- **Unlocked episodes remain unlocked through a premium lapse.**
  `get-episode-audio`'s access check treats "has an `unlocks` row" and
  "`is_premium` is true" as independent, either-is-sufficient
  conditions — not "premium unlocks everything and losing premium
  revokes it." An `EXPIRATION` webhook event flips `is_premium` to
  `false` but never touches `unlocks` rows.

## Product identifiers and `app_settings`

`app_settings`'s `coin_pack_products` and `premium_product_id` rows are
the single source of truth `revenuecat-webhook` uses to map a
RevenueCat `product_id` to app behavior — a data lookup, not code, so a
product identifier can change via a one-row `UPDATE`, no redeploy
needed.

**Placeholder identifiers currently seeded** (update these once real
products exist):

| `app_settings` key   | Placeholder value                                          |
| -------------------- | ---------------------------------------------------------- |
| `coin_pack_products` | `{"coins_100": 100, "coins_500": 500, "coins_1200": 1200}` |
| `premium_product_id` | `"premium_monthly"`                                        |

## What to set up before real purchases work

1. **Apple Developer account** ($99/year) and **Google Play Console
   account** ($25 one-time), if not already set up.
2. **App Store Connect / Play Console products:** three consumable
   in-app purchases (coin packs) and one auto-renewing subscription
   (premium), with real product identifiers of your choosing.
3. **A RevenueCat project**, linked to both stores, with an "Offering"
   containing all four products as packages.
4. Update `app_settings.coin_pack_products`/`premium_product_id` to
   match the real product identifiers chosen in step 2 (if they differ
   from the placeholders above).
5. Set the real `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` and
   `EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY` (from the RevenueCat
   project's API keys page) in `apps/mobile/.env`.
6. In the RevenueCat dashboard, configure a webhook pointing at the
   deployed `revenuecat-webhook` edge function's URL, enable HMAC
   signing, and set the resulting signing secret as this project's
   `REVENUECAT_WEBHOOK_SECRET` Supabase Edge Function secret.

## Testing with the RevenueCat sandbox

- Create sandbox tester accounts in App Store Connect (Users and
  Access → Sandbox Testers) and/or a license-tester account in Play
  Console.
- Sign into the sandbox/tester account on a real device (or simulator,
  for iOS), then use the coin purchase screen — sandbox purchases go
  through the same `Purchases.purchasePackage(...)` code path as
  production.
- **Sandbox purchases still fire real webhook events**, tagged
  `environment: "SANDBOX"` in the payload — `revenuecat-webhook` does
  not currently branch on this field, so sandbox and production
  purchases are credited identically. This is intentional for now: it
  means sandbox testing exercises the exact same code path production
  does.
- A deployed `revenuecat-webhook` function works against both sandbox
  and production purchases automatically — there's no separate
  "sandbox mode" to switch on server-side, only the RevenueCat
  project's own sandbox/production API key distinction on the client.

## Known scope boundary: coin-pack refunds

A `CANCELLATION` event on a coin pack (a non-renewing purchase being
refunded) is currently ignored — the credited coins are **not** clawed
back. This is a deliberate, disclosed scope boundary: Prompt 16
("Payments Hardening") explicitly covers corrections via compensating
`refund`-type `transactions` rows, and general fraud/rate-limiting
protections. Until then, a refunded coin-pack purchase leaves the
credited coins in place.
```

- [ ] **Step 2: Commit**

```bash
git add docs/monetization.md
git commit -m "Prompt 9: add docs/monetization.md"
```

---

### Task 10: Whole-repo verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck, lint, and test run**

```bash
pnpm typecheck
pnpm lint
cd apps/mobile && npx jest
```

Expected: all green — every workspace package typechecks and lints
clean, and every test file (including this feature's
`unlock-episode.test.ts`, plus every pre-existing test) passes.

- [ ] **Step 2: Confirm no stray references to the removed stub remain**

```bash
grep -rn "UnlockSheetStub\|unlock-sheet-stub" apps/mobile/src
```

Expected: no matches.

- [ ] **Step 3: Confirm the fairness-rule invariant holds by inspection**

```bash
grep -rln "coin_balance\s*=" supabase/migrations supabase/functions
```

Expected: exactly one match — `unlock_episode`'s decrement and
`revenuecat-webhook`'s credit are the only two writers of
`coin_balance` in the whole codebase. (`revenuecat-webhook`'s credit
uses `coin_balance: profile.coin_balance + action.coins` via the
Supabase JS client rather than raw SQL, so it won't literally match
this grep pattern — treat this step as confirming `unlock_episode` is
the only _decrementing_ writer, and manually re-read
`revenuecat-webhook`'s update call as the one intentional credit path.)

- [ ] **Step 4: Final commit if anything was fixed during verification**

Only if Step 1 required a fix:

```bash
git add -A
git commit -m "Prompt 9: verification fixes"
```
