# Authentication (Prompt 5) — Design Spec

## Scope

Implement authentication end to end with Supabase Auth, across both apps,
per `docs/PROMPT_PACK.md`'s Prompt 5. This is the first prompt to write
real application code — `apps/mobile` and `apps/admin` currently contain
only their framework default scaffolds (Expo Router's template, Next.js's
template), with Supabase client libraries already installed and `.env.example`
files already correct, but no client instantiation, no routing structure,
and no screens.

**Non-goals for this prompt** (deferred to the prompts named below, per the
23-prompt sequence — not gaps, deliberate scope boundaries):

- No real Home/tab screens or MiniPlayer (Prompt 6)
- No favorites, progress-sync, coins, or premium-purchase call sites for
  the guest-mode gate primitive this prompt introduces (Prompts 9, 10, 13, 16)
- No admin dashboard content beyond auth (Prompt 14+)
- No rate-limiting on auth endpoints (Prompt 18's security/hardening pass)
- No live end-to-end test against a real Supabase project (no Supabase
  CLI/Docker/local stack in this environment, per the project's established
  convention — same constraint as every schema prompt so far)

## Database changes

One migration, additive to Prompt 2's already-applied
`handle_new_user()` trigger (`supabase/migrations/20260721150400_handle_new_user_trigger.sql`).

**Problem:** `display_name` currently falls back through
`raw_user_meta_data ->> 'display_name'` → `'full_name'` → the email
prefix → `'New Listener'`. A phone-only signup (no email, Prompt 5's OTP
path) has no email prefix to fall back to, so every phone signup would
land on the generic `'New Listener'`.

**Fix:** insert one more fallback step before the final default, using
`new.phone` (populated by Supabase for phone signups): a masked
"Listener •••<last 4 digits>" — never the full phone number, since
`display_name` is broadly readable (e.g. by other users, depending on
future features) and a phone number is more sensitive than an email
prefix.

```sql
coalesce(
  new.raw_user_meta_data ->> 'display_name',
  new.raw_user_meta_data ->> 'full_name',
  split_part(new.email, '@', 1),
  case
    when new.phone is not null and length(new.phone) >= 4
      then 'Listener •••' || right(new.phone, 4)
  end,
  'New Listener'
)
```

No other schema changes. `profiles`, `profiles_select_own` /
`profiles_update_own` RLS, and the `role` enum (`'listener' | 'teacher' |
'guide' | 'admin'`, already includes `'admin'`) are already correct for
this prompt's needs.

## New dependencies

| Package                                              | App    | Purpose                                                                                                                                                                         |
| ---------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `expo-secure-store`                                  | mobile | Encrypted session persistence (Keychain/Keystore-backed)                                                                                                                        |
| `zod`                                                | mobile | Form validation schemas (email, password, OTP digits, phone)                                                                                                                    |
| `react-hook-form`                                    | mobile | Form state, shared validation pattern with admin                                                                                                                                |
| `@hookform/resolvers`                                | both   | Connects zod schemas to react-hook-form's `resolver` option — neither app has this wired up yet, despite admin already having `zod` + `react-hook-form` installed independently |
| `jest`, `jest-expo`, `@testing-library/react-native` | mobile | Unit tests                                                                                                                                                                      |
| `vitest`                                             | admin  | Unit tests                                                                                                                                                                      |

`turbo.json` gets a `test` task (`"test": { "dependsOn": ["^build"] }`,
matching the existing `lint`/`typecheck` shape) and each app's
`package.json` gets a `"test"` script.

## Mobile app (`apps/mobile`)

### Supabase client & session storage

`src/lib/supabase.ts` creates a single client with a custom `storage`
adapter (`src/lib/secure-store-adapter.ts`) implementing the
`{ getItem, setItem, removeItem }` interface `@supabase/supabase-js`
expects, backed by `expo-secure-store`.

`expo-secure-store` has a per-key value-size ceiling (historically ~2048
bytes on some platforms) that a serialized Supabase session (access +
refresh token + user object) can occasionally exceed. The adapter handles
this internally:

- `setItem`: if the serialized value fits in one chunk, store it under
  the plain key. If not, split it into fixed-size chunks stored under
  `${key}.0`, `${key}.1`, … plus `${key}.chunks` recording the count.
- `getItem`: if `${key}.chunks` exists, reassemble; otherwise read the
  plain key directly (covers the common case with zero overhead).
- `removeItem`: removes the plain key and, if present, every numbered
  chunk key plus the count key.

Client config: `autoRefreshToken: true`, `persistSession: true`,
`detectSessionInUrl: false` (no URL bar in React Native).

### Auth store (zustand)

`src/stores/auth-store.ts`:

```ts
type AuthState = {
  session: Session | null;
  guestMode: boolean;
  passwordRecovery: boolean; // true only during the reset-password deep-link flow
  loading: boolean; // true until the first onAuthStateChange fires
  continueAsGuest: () => void;
  signOut: () => Promise<void>;
  // internal: setSession/setLoading/setPasswordRecovery, called only by useAuthListener
};
```

`src/hooks/use-auth-listener.ts` — mounted once, in the root layout —
subscribes to `supabase.auth.onAuthStateChange` and is the _only_ writer
to `session`/`loading` in the store. No screen calls
`supabase.auth.getSession()` directly; they all read the store.

`guestMode` is an explicit third state, not inferred from
`session === null` — a user who hasn't chosen anything yet
(`loading` or fresh install) is different from a user who tapped
"Continue as Guest." `continueAsGuest()` sets `guestMode: true`;
`signOut()` also resets `guestMode: false` (signing out returns to the
Welcome screen, not back into guest mode).

### Routing (Expo Router groups)

- `(auth)/welcome.tsx` — "Sign In" / "Create Account" / "Continue as Guest"
- `(auth)/sign-in.tsx` — email + password; "Use phone number instead" link
- `(auth)/sign-up.tsx` — email + password + display name (optional)
- `(auth)/phone-sign-in.tsx` — country-code dropdown (hardcoded list: Kenya,
  Uganda, Tanzania, Rwanda, Ethiopia, Nigeria, + "Other" free-entry) + local
  digits, combined to E.164 before calling `signInWithOtp({ phone })`. This
  is the only phone entry point — there is no separate "phone sign up"
  screen, because Supabase's default `shouldCreateUser: true` behavior
  means `signInWithOtp({ phone })` transparently creates a new user (and
  fires the `handle_new_user()` trigger) the first time a number is used,
  and signs an existing user in on subsequent uses. The screen's copy
  reflects this ("Enter your phone number to sign in or create an
  account"), rather than asking the user to choose sign-in vs. sign-up.
- `(auth)/otp-verify.tsx` — 6-digit code entry, 30-second resend cooldown
- `(auth)/forgot-password.tsx` — email entry →
  `resetPasswordForEmail(email, { redirectTo: 'villagefireside://reset-password' })`
- `(auth)/reset-password.tsx` — new-password entry; reachable only via the
  deep link above (Expo Router's linking config maps the custom scheme path
  to this route). Opening the link doesn't hand the screen a usable session
  by itself: Supabase's redirect fires a `PASSWORD_RECOVERY` event through
  the same `onAuthStateChange` subscription `useAuthListener` already owns,
  carrying a temporary recovery session. `useAuthListener` records this as
  an extra `passwordRecovery: boolean` field on the auth store; the
  reset-password screen renders only while it's true, and submits the new
  password via `supabase.auth.updateUser({ password })` against that
  recovery session — no separate token-exchange step for the screen itself
  to implement.
- `(app)/index.tsx` — placeholder authenticated screen: "Signed in as
  {display_name}" + a sign-out button. Prompt 6 replaces this with the real
  tab shell.

Root `_layout.tsx` renders `useAuthListener()` once, then — once
`loading` is false — a `<Redirect>` to `(auth)/welcome` if
`!session && !guestMode`, or to `(app)` if `session || guestMode`.

### Guest-mode gate primitive

`src/hooks/use-require-auth.ts`:

```ts
function useRequireAuth(): {
  requireAuth: (action: () => void) => void;
  promptVisible: boolean;
  dismissPrompt: () => void;
};
```

If `session` is present, `requireAuth(action)` calls `action()`
immediately. If in guest mode, it sets `promptVisible: true` instead of
calling `action`. `src/components/sign-in-prompt-sheet.tsx` is a bottom
sheet ("Sign in to continue" + Sign In / Create Account buttons + a
dismiss affordance) that any screen renders conditionally on
`promptVisible`. This ships as a tested, inert utility — no call sites in
this prompt, since there is no gated feature yet to call it from.

### Errors

`src/components/form-error.tsx` — small red text component. Validation
errors come from react-hook-form's error state (driven by the zod
schemas in `src/lib/validation.ts`); Supabase API errors (wrong password,
OTP expired, network failure) are caught per-screen into a local
`apiError` string and rendered the same way, above the submit button.

## Admin app (`apps/admin`)

### Supabase clients

`@supabase/ssr`'s standard browser/server split:

- `src/lib/supabase/client.ts` — `createBrowserClient(...)`, used by the
  sign-in form (client component)
- `src/lib/supabase/server.ts` — `createServerClient(...)` reading/writing
  the Next.js cookie store, used by proxy and server components

### Proxy (formerly "middleware")

This project runs Next.js 16, where the `middleware.ts` file convention is
deprecated and renamed to `proxy.ts` (the exported function is named
`proxy`, not `middleware`; `apps/admin/AGENTS.md` flags this exact kind of
breaking change and was confirmed against the installed
`next/dist/docs/.../file-conventions/proxy.md`). Functionally this plays
the same role the prompt's "protect all admin routes with middleware"
instruction describes — the rename doesn't change the architecture below,
only the file name and export name.

`src/proxy.ts`, `config.matcher` excludes `/sign-in`, `/not-authorized`,
and static assets:

1. `supabase.auth.getUser()` — also refreshes the session cookie as a
   side effect (the standard `@supabase/ssr` pattern, using `getAll`/
   `setAll` cookie methods, not the deprecated `get`/`set`/`remove` trio).
   No user → redirect to `/sign-in`.
2. User present → `supabase.from('profiles').select('role').eq('id',
user.id).single()`. This is allowed under the already-applied
   `profiles_select_own` RLS policy (`auth.uid() = id`) — no new policy
   needed. `role !== 'admin'` → redirect to `/not-authorized`.

Keeping both checks in proxy (rather than session-only in proxy + a
separate role-check in a layout) matches the prompt's literal "protect
all admin routes with middleware," and is a small, standard addition to
the cookie-refresh call the `@supabase/ssr` pattern already requires.

### Screens

- `/sign-in` — email + password, react-hook-form + zod, same
  `<FormError>` convention as mobile. No self-serve sign-up (admins are
  provisioned manually — see Docs, below).
- `/not-authorized` — explains the account isn't an admin account, signs
  the user out (`supabase.auth.signOut()`) on mount or via a "Back to
  sign in" button.

## Testing

TDD throughout, for the logic that can genuinely be unit-tested without a
live Supabase project or a rendered screen tree:

**Mobile (`jest-expo`):**

- `src/lib/secure-store-adapter.test.ts` — mocked `expo-secure-store`;
  round-trips a small value through the plain-key path and a >2048-byte
  value through the chunked path; `removeItem` cleans up every chunk key
- `src/lib/validation.test.ts` — the zod schemas (valid/invalid email,
  password minimum length, 6-digit OTP, E.164 phone shape)
- `src/hooks/use-require-auth.test.ts` — mocked auth store; signed-in
  calls the action directly, guest mode opens the prompt instead

**Admin (`vitest`):**

- `src/lib/validation.test.ts` — shared-shape zod schemas (email,
  password) — same rules as mobile, tested independently since the two
  apps don't share a validation module (different runtime concerns,
  React Native vs. Next.js)
- `src/proxy.test.ts` — mocked Supabase server client; three cases
  (no session → redirect to `/sign-in`; session + non-admin role →
  redirect to `/not-authorized`; session + admin role → request proceeds)

**Explicitly not covered by automated tests:** full screen
rendering/navigation, and any real network call to Supabase Auth — both
require a live Supabase project, which doesn't exist in this
environment. The implementation plan will call out running `expo start
--web` and `pnpm dev` (admin) against a real Supabase project, after the
new migration is applied, as the authoritative end-to-end check — same
convention as "apply the migration files by hand" in every prior PR's
test plan.

## Docs

New `docs/auth.md`:

- The auth architecture summary above (mobile store + route groups,
  admin proxy), so later prompts (6+) know how to check auth state
  rather than re-deriving it
- The guest-mode gate contract (`useRequireAuth`) for Prompt 6+ to adopt
  at real gated actions
- The SQL snippet to promote a profile to admin, per the prompt's
  explicit ask:
  ```sql
  update profiles set role = 'admin' where id = '<user-uuid-from-auth.users>';
  ```
