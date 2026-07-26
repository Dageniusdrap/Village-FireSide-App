# Coins, Unlocks & Premium (Prompt 9) — Design Spec

## Scope

Full monetization flow for the mobile app, per `docs/PROMPT_PACK.md`'s
Prompt 9:

- A real Unlock Sheet (replacing Prompt 8's stub): coin price, "Unlock
  for X coins", a "Go Premium" upsell, routing to a purchase screen on
  insufficient balance.
- Server-side, atomic coin-unlock: a Postgres function wrapped by a new
  `unlock-episode` edge function. The client is never trusted with
  balance math.
- RevenueCat (`react-native-purchases`) integration: coin packs (100 /
  500 / 1200 coins) and a monthly premium subscription, purchasable via
  a new dedicated coin-purchase screen.
- A `revenuecat-webhook` edge function that credits coins or sets
  premium status on verified purchase events.
- A new `app_settings` config table for tunable values.
- Two fairness rules — coins never expire; unlocked episodes stay
  unlocked through a premium lapse — enforced structurally and
  documented in `docs/monetization.md`.
- Profile screen: coin balance, premium status, and entry points into
  the purchase screen.

**Non-goals (explicitly deferred):**

- **RevenueCat/App Store/Play Store account setup.** No such accounts
  exist yet for this project. This spec builds the complete code path
  against placeholder env vars and placeholder product identifiers
  (`coins_100`, `coins_500`, `coins_1200`, `premium_monthly`) — the
  same pattern `apps/mobile/.env.example` already uses for Supabase.
  Real purchases cannot be tested until real accounts/products exist;
  `docs/monetization.md`'s sandbox-testing section spells out exactly
  what needs to be created and where the resulting values go.
- **Webhook/unlock idempotency hardening** (a unique constraint on
  `transactions.reference`, `ON CONFLICT DO NOTHING` handling for
  duplicate webhook delivery) — Prompt 16's explicit job. This prompt
  populates `reference` with RevenueCat's event id so Prompt 16 has
  something to constrain against, but does not add the constraint or
  any duplicate-delivery defense beyond the unlock function's own
  already-unlocked short-circuit (a correctness necessity, not the
  idempotency hardening Prompt 16 covers).
- **Mobile money** (MTN MoMo, Airtel Money) — explicitly Prompt 16's
  job, not started here.
- **Admin-side per-episode access-tier overrides and enforcement of
  `default_free_episode_count`** — Prompt 14's job. This prompt only
  creates the `app_settings` row Prompt 14 will read; no code currently
  applies it (there is no episode-creation UI yet to apply it in).
- **Rate-limiting `unlock-episode`** — Prompt 16's "fraud basics" item.
- **RevenueCat's prebuilt paywall UI** (`react-native-purchases-ui`) —
  every other screen in this app uses its own themed component set
  (`ThemedText`, `Card`, `Button`, `Chip`, the app's color/font
  constants); the purchase screen is built the same way, reading raw
  `Purchases.getOfferings()` data rather than rendering a
  RevenueCat-styled paywall.

## `app_settings` table

```sql
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
```

Public read access is deliberate: `default_free_episode_count` needs to
be readable by the mobile app in later prompts (e.g. to display "3 free
episodes" copy) without an admin session, the same way `is_published`
content is publicly readable. Writes stay admin-only, matching every
other config-shaped table in this schema.

Seeded rows (inserted by this prompt's migration, not admin UI, since
no admin UI exists yet):

| `key`                        | `value`                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `default_free_episode_count` | `3`                                                        |
| `coin_pack_products`         | `{"coins_100": 100, "coins_500": 500, "coins_1200": 1200}` |
| `premium_product_id`         | `"premium_monthly"`                                        |

`coin_pack_products` and `premium_product_id` are the single source of
truth the webhook uses to map a RevenueCat `product_id` to app
behavior — a data lookup, not a hardcoded `switch` in edge function
code, so a product identifier can change (e.g. when real store products
are created and don't happen to match the placeholder strings) via a
one-row `UPDATE`, not a redeploy.

## `unlock_episode` Postgres function

The atomic core the prompt requires ("use a Postgres function with a
transaction... NEVER trust the client with balance math"):

```sql
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
    return jsonb_build_object('result', 'insufficient_coins', 'balance', v_balance, 'price', v_episode.coin_price);
  end if;

  update profiles set coin_balance = coin_balance - v_episode.coin_price where id = p_user_id;

  insert into unlocks (user_id, episode_id) values (p_user_id, p_episode_id);

  insert into transactions (user_id, transaction_type, amount, coins_delta, episode_id)
  values (p_user_id, 'episode_unlock', v_episode.coin_price, -v_episode.coin_price, p_episode_id);

  return jsonb_build_object('result', 'unlocked');
end;
$$;
```

`SELECT ... FOR UPDATE` on the profile row is what makes the
check-then-decrement race-free under concurrent calls (e.g. two rapid
taps) — the second call's `SELECT` blocks until the first transaction
commits, then re-reads the already-decremented balance. The
already-unlocked short-circuit runs before acquiring the lock (a cheap
read), so a retried request after a successful unlock never re-charges
or re-locks the row. This function is written to be called only by the
service role (same trust boundary `plays`/`unlocks` already use) — it
takes `p_user_id` explicitly rather than relying on `auth.uid()`,
because the edge function calling it authenticates the caller itself
(see below) and then acts via the service-role client, under which
`auth.uid()` would be null.

## `unlock-episode` edge function

Mirrors `get-episode-audio`'s existing structure exactly (anon client
verifies the JWT, service client does the privileged work):

```ts
// supabase/functions/unlock-episode/index.ts
// 1. Parse { episode_id } from the request body, validate as a UUID.
// 2. Verify the caller's JWT via the anon client -> userId. Reject (401)
//    if there's no valid JWT — unlike get-episode-audio, unlocking has
//    no meaningful anonymous/guest path.
// 3. Call unlock_episode(userId, episodeId) via the service-role client.
// 4. Map the function's `result` field to an HTTP response:
//    "unlocked" | "already_unlocked" -> 200 { ok: true }
//    "insufficient_coins"            -> 402 { error: "insufficient_coins", balance, price }
//    "not_coin_gated"                -> 400 { error: "not_coin_gated" }
//    "not_found"                     -> 404 { error: "not_found" }
```

`already_unlocked` is folded into the 200 success response rather than
treated as an error — from the client's perspective, "you can now play
this episode" is true either way, and the Unlock Sheet's job is done.

## `revenuecat-webhook` edge function

**Signature verification** uses RevenueCat's HMAC mechanism (the
stronger of its two documented options, and the one that matches the
prompt's literal "verify webhook signature" wording): the
`X-RevenueCat-Webhook-Signature` header has the form
`t=<unix_timestamp>,v1=<hex_hmac>`, where `hex_hmac` is
`HMAC-SHA256("{timestamp}.{raw_request_body}", REVENUECAT_WEBHOOK_SECRET)`
in hex. Verification parses `t`/`v1` out of the header, recomputes the
HMAC over the timestamp and the _raw_ (unparsed) request body, and
compares in constant time. `REVENUECAT_WEBHOOK_SECRET` is a new Supabase
Edge Function secret — a placeholder until the RevenueCat dashboard's
webhook configuration exists; `docs/monetization.md` documents how to
generate and set the real value.

**Event handling**, keyed on `event.type`:

| Event type(s)                                                                                                                    | Action                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NON_RENEWING_PURCHASE`                                                                                                          | Look up `event.product_id` in `app_settings.coin_pack_products`; credit that many coins to `event.app_user_id`.                                                                               |
| `INITIAL_PURCHASE`, `RENEWAL`, `UNCANCELLATION`, `PRODUCT_CHANGE` (where `product_id` matches `app_settings.premium_product_id`) | Set `is_premium = true`, `premium_expires_at = event.expiration_at_ms` (converted to `timestamptz`).                                                                                          |
| `EXPIRATION`                                                                                                                     | Set `is_premium = false`. **Not** `CANCELLATION` — cancelling only stops future renewal; access continues until the subscription actually expires, which is what `EXPIRATION` reports.        |
| `CANCELLATION`, `BILLING_ISSUE`, `TEST`, anything else                                                                           | No state change. Still insert a `transactions` row (`transaction_type = 'subscription'`, `amount = 0`) for observability, except `TEST` which is acknowledged (200) without writing anything. |

Every state-changing event inserts a `transactions` row with
`reference = event.id` (RevenueCat's own unique event id) — not yet
constrained unique (Prompt 16), but already in place so that migration
is additive, not a backfill.

`app_user_id` is trusted to equal a `profiles.id` because the mobile
app sets RevenueCat's App User ID to the Supabase user id at login (see
below) — the webhook does not need to look up a mapping table, just
treat `event.app_user_id` as the `profiles.id` to update directly.

## Mobile: RevenueCat wiring

- `npx expo install react-native-purchases` (no Expo config plugin
  exists for this package — verified against RevenueCat's current
  docs; it autolinks like any other native module). The Dev Client
  build Prompt 8 already made mandatory covers this too; no new native
  infrastructure requirement.
- `apps/mobile/src/hooks/use-configure-purchases.ts` — mirrors Prompt
  8's `useConfigureAudioMode`: a `useEffect` at root layout calling
  `Purchases.configure({ apiKey })` once, with a platform-specific key
  (`EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`,
  placeholders in `.env.example`).
- RevenueCat's App User ID is kept in sync with Supabase auth from
  inside the existing `useAuthListener` hook: `Purchases.logIn(session.user.id)`
  on sign-in, `Purchases.logOut()` on sign-out. This is what lets the
  webhook treat `app_user_id` as `profiles.id` directly.

## Mobile: real Unlock Sheet

Replaces `UnlockSheetStub` (same trigger — the player store's
`lockedEpisode` state — Prompt 8 built the stub specifically so this
swap wouldn't need to change where it's triggered from):

- For a `coins`-tier episode: title, price, an enabled "Unlock for X
  coins" button calling `unlock-episode`, plus a "Go Premium" row below
  it (premium and coins are both valid ways to unlock a coins-tier
  episode — `get-episode-audio`'s existing access check already grants
  access to any non-free episode when `is_premium` is true, regardless
  of that episode's specific tier).
- For a `premium`-tier episode: only the "Go Premium" row — there is no
  coin price to offer, and `unlock_episode`'s Postgres function
  explicitly rejects a coin-unlock attempt on a non-`coins`-tier
  episode with `not_coin_gated`.
- On the edge function's `402 insufficient_coins` response, navigate to
  the coin purchase screen instead of showing an error.
- The "Go Premium" row routes to the purchase screen the same way the
  coin option's insufficient-balance path does.
- Both actions gated behind `useRequireAuth` — a guest sees the
  existing `SignInPromptSheet` first, matching every other guest-gated
  action since Prompt 7.
- On a successful unlock, dismiss the sheet and resume the auto-advance
  or manual play that triggered it.

## Mobile: coin purchase screen

A new dedicated route, `apps/mobile/src/app/(app)/coins.tsx` — not
another modal sheet. Unlike Prompt 8's small sheets (`BookmarkSheet`,
`SignInPromptSheet`), this needs to list multiple products with live
store-localized pricing, loading/purchasing states, and a premium
comparison — closer in weight to `/sign-in` than to a slide-up sheet.

- Fetches `Purchases.getOfferings()` on mount; renders the three coin
  packs and the premium subscription using their real
  `product.priceString` — no hardcoded currency amounts anywhere in
  the app; the store is the only source of price.
- Tapping a product calls `Purchases.purchasePackage(pkg)`; a
  "Processing…" state covers the purchase promise, then the screen
  invalidates and refetches the user's profile (balance/premium are
  read from `profiles`, kept current by the webhook — the screen never
  reads `CustomerInfo` for gating, only for driving the purchase flow
  itself).
- A "Restore Purchases" button (`Purchases.restorePurchases()`) —
  required by App Store review guidelines for any non-consumable or
  subscription product.
- Reachable from the Unlock Sheet's insufficient-balance/Go-Premium
  paths and from the Profile screen's new "Buy Coins" / "Manage
  Premium" buttons.

## Mobile: Profile screen

Adds coin balance and premium status/expiry, queried from `profiles`
via TanStack Query (so a webhook-driven credit shows up on next
focus/refetch without a manual reload), plus the two buttons routing to
`/coins`.

## Fairness rules

Both are structural consequences of the schema, not extra runtime
checks — stated here so `docs/monetization.md` can point back to the
actual mechanism rather than asserting a policy with nothing backing
it:

- **Coins never expire:** nothing in this schema or in the webhook ever
  decrements `coin_balance` on a timer or on any event other than a
  successful `unlock_episode` call. There is no decay path to
  accidentally introduce.
- **Unlocked episodes remain unlocked through a premium lapse:**
  `get-episode-audio`'s existing access check (built in Prompt 4)
  already treats "has an `unlocks` row" and "`is_premium` is true" as
  independent, either-is-sufficient conditions — not "premium unlocks
  everything and losing premium revokes it." An `EXPIRATION` webhook
  event flips `is_premium` to `false` but never touches `unlocks` rows,
  so a coin-unlocked episode's access is unaffected by any premium
  state change.

## `docs/monetization.md`

New document covering: the full purchase flow end-to-end (client →
RevenueCat → webhook → Supabase), the two fairness rules and the
mechanism behind each (linking back to this spec's reasoning), the
`app_settings` product/coin mapping and how to update it when real
product identifiers exist, and a "testing with the RevenueCat sandbox"
section: creating sandbox tester accounts in App Store Connect / Play
Console, that sandbox purchases still fire real webhook events tagged
`environment: "SANDBOX"`, and how to point a deployed
`revenuecat-webhook` function at a sandbox-configured RevenueCat
project during testing.

## Testing approach

Same convention as every prior prompt: `pnpm typecheck`/`pnpm lint`/`pnpm test`
are the verification bar, with real unit tests where there's isolable
logic:

- `unlock_episode`'s result branches (not found, not coin-gated,
  already unlocked, insufficient balance, success) — tested at the
  edge-function layer with a mocked Supabase client standing in for the
  RPC call's return value, following the existing
  `resolve-episode-source.test.ts` mocking convention.
- The webhook's event-type → state-change mapping (a pure function
  separated from the HTTP/signature-verification plumbing, so it's
  testable without constructing real HTTP requests).
- HMAC signature verification — a pure function tested against a known
  timestamp/secret/body/signature quadruple (valid case, tampered-body
  case, expired-timestamp case if a freshness window is implemented,
  wrong-secret case).

Actual purchases, real RevenueCat webhook delivery, and App Store/Play
Store sandbox behavior are manual/device-and-dashboard verification,
out of this environment's scope — the same carve-out Prompt 8 made for
native audio playback, lock-screen controls, and interruption recovery.
