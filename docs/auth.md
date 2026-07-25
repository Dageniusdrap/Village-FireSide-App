# Authentication

## Mobile (`apps/mobile`)

Auth state lives in a zustand store (`src/stores/auth-store.ts`): `session`,
`guestMode`, `passwordRecovery`, and `loading`. A single hook,
`useAuthListener` (mounted once, in the root layout), is the only writer to
`session`/`loading` — it subscribes to `supabase.auth.onAuthStateChange`. No
screen calls `supabase.auth.getSession()` directly; they all read the store.
Setting a truthy `session` (through `_setSession`, the one setter both the
initial `getSession()` and every `onAuthStateChange` event flow through) also
clears `guestMode`, so a real sign-in never leaves stale guest state behind.

Password recovery needs an extra hook because native URL detection is off
(`detectSessionInUrl: false` in `src/lib/supabase.ts` — RN has no `window`).
`useRecoveryLinkHandler` (also mounted once, in the root layout) listens for
the `villagefireside://reset-password` deep link via `expo-linking`, parses it
with the pure `src/lib/recovery-link.ts` (`parseRecoveryLink`, handling both
PKCE `?code=…&type=recovery` and implicit `#access_token=…&type=recovery`
links), establishes the recovery session via
`exchangeCodeForSession`/`setSession`, and sets `passwordRecovery` to `true`.
The root layout then redirects a session with `passwordRecovery` set to
`(auth)/reset-password`; that screen clears the flag on a successful password
update, after which the next redirect sends the now-authenticated user to
`(app)`.

Routing is two Expo Router groups: `(auth)` (Welcome, Sign In, Sign Up,
Phone Sign In, OTP Verify, Forgot Password, Reset Password) and `(app)` (a
placeholder authenticated screen for now — Prompt 6 replaces it with the
real tab shell). The root layout renders a `<Redirect>` to `(auth)/welcome`
when there's no session and no guest mode, to `(auth)/reset-password` when a
session has `passwordRecovery` set, and to `(app)` otherwise (a session
without recovery, or guest mode).

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
