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
