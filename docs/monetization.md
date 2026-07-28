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
   and RevenueCat. Both of the webhook's writes — the `transactions` row
   that marks the event processed and the `profiles` mutation itself —
   happen inside one `apply_revenuecat_event` transaction, so a partial
   failure can't leave a purchase recorded but uncredited; a genuine
   failure rolls both back and answers non-2xx so RevenueCat retries.
   Because the purchase is credited to whichever profile the RevenueCat
   App User ID names, the purchase screen requires a signed-in session.
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
- **A stale webhook event can't cost a subscriber access they paid for.**
  `apply_revenuecat_event` only ever moves `premium_expires_at` forward,
  and only honours an `EXPIRATION` whose expiry isn't older than the one
  already stored — so an out-of-order delivery can't shorten or revoke
  premium that a later renewal already extended.

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

   **Required:** `revenuecat-webhook` must be deployed with JWT
   verification disabled. Supabase verifies a Supabase-issued JWT on
   every edge function request by default and rejects it with a
   platform-level 401 _before_ the function's own code runs — and
   RevenueCat, as a third-party sender, has no Supabase JWT to present
   (it authenticates its deliveries with the HMAC signature the function
   verifies itself). `supabase/config.toml` already sets
   `verify_jwt = false` for this one function, which the CLI applies on
   `supabase functions deploy revenuecat-webhook`; if you deploy some
   other way, pass `--no-verify-jwt`. Every other edge function keeps the
   default, since they're called by the app with a real user session.

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
