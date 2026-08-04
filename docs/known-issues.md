# Known Issues

Tracked gaps that are understood and deliberately deferred, not forgotten.
Each entry should carry enough context for the Prompt 20 final production
audit to triage it (fix, defer further, or accept) without re-deriving the
investigation.

## Mobile

### Auth screen group has no back-navigation affordance

`apps/mobile/src/app/(auth)/_layout.tsx` sets `headerShown: false` for the
entire `(auth)` Stack, so none of Welcome, Sign In, Sign Up, Phone Sign In,
OTP Verify, Forgot Password, or Reset Password has a back button, and none
of those screens renders its own. This spans the whole group — it predates
Prompt 7 (Home & Discovery) and was inherited from the earlier
authentication plan.

It was low-impact while the root layout's auth-redirect guard immediately
bounced a guest away from `/sign-in` on the next re-render (a bug fixed in
Prompt 7 — see `apps/mobile/src/lib/auth-redirect.ts`). Now that a guest can
actually reach and stay on Sign In or Sign Up (e.g. from a
`SignInPromptSheet`), there is no way back to Welcome or to the previous
screen if they change their mind, short of the Android hardware back
button.

**Fix shape:** add a shared back affordance at the `(auth)` layout level
(or per-screen, matching Prompt 7's `apps/mobile/src/components/ui/back-button.tsx`
pattern used for the Series/Contributor/Cultural-Group detail screens) —
touches multiple pre-existing screens, so it's its own small task rather
than a piecemeal addition to one screen.

**Severity:** UX polish, not a correctness bug. No data loss or dead end —
Android hardware back and iOS's lack of an alternative just make the guest
sign-in/sign-up detour feel unfinished.

### `profiles.country` capture not yet exercised through the real mobile UI

Prompt 12's final-review fix added two write paths for `profiles.country`
(`apps/mobile/src/app/(auth)/otp-verify.tsx` after phone sign-in, and the
country picker in `apps/mobile/src/app/(app)/settings.tsx`), which
`apps/mobile/src/hooks/queries/use-app-settings.ts`'s
`useCulturalGroupsEnabled()` gate depends on. The write was verified
directly against live RLS/triggers (simulated signup + the app's exact
`UPDATE profiles SET country = ...` statement, run as the owning user,
in a rolled-back transaction) — the database side is confirmed correct.
It has not been exercised through the actual Expo UI (no device/simulator
available in this environment), so the route-param handoff from
`phone-sign-in.tsx` to `otp-verify.tsx` and the settings picker's `onPress`
wiring are unverified in practice.

**Fix shape:** no code change expected — just a manual pass (phone sign-in
→ OTP verify → confirm `profiles.country` is set; settings screen → select
a country → confirm it persists and the Home cultural-groups rail appears
for a seeded `cultural_groups_enabled_countries` value) on a real device or
simulator.

**Severity:** Should be done before any release involving real users —
if the UI wiring has a bug the DB-level check can't catch, the cultural-group
gate silently stays closed again, the exact failure mode Prompt 12's final
review flagged as Critical.
