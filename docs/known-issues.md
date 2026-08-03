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

### Error boundary's Restart button is currently inert (no EAS Update configured)

`apps/mobile/src/components/error-boundary.tsx`'s "Restart" button calls
`Updates.reloadAsync()`, but `expo-updates` is not actually configured for
this project: `apps/mobile/app.json` has no `updates` key, no
`runtimeVersion`, and does not list `expo-updates` in its `plugins` array,
and there is no `eas.json` anywhere in the repo. Per the installed
package's own type declarations (`expo-updates`'s `Updates.d.ts`, the
`reloadAsync` doc comment around lines 84-109) and the versioned SDK 57
docs (docs.expo.dev/versions/v57.0.0/sdk/updates/), `reloadAsync()`
rejects whenever `expo-updates` isn't properly enabled/configured — which
is the case for every build variant this repo can currently produce (dev
client, Expo Go, and any production build, since none of them have updates
configured). The button's tap handler catches this rejection safely (no
crash, no unhandled rejection), but the reload itself never happens.

**Fix shape:** set up EAS Update properly — register the `expo-updates`
config plugin in `app.json`, configure `runtimeVersion`, create an
`eas.json` with update channels, and wire a real publish workflow (e.g. a
CI step or manual `eas update` command tied to release branches). This is
meaningfully more infrastructure than a single task's scope and should be
planned as its own piece of work.

**Severity:** Low-to-moderate. The error boundary still correctly catches
render crashes and shows the "Something went wrong" fallback screen —
only the Restart button's actual reload action is currently a no-op. A
user who hits a render crash today would need to manually force-quit and
reopen the app themselves rather than tapping Restart.

### Share links only work for recipients who already have the app

`ShareButton` (`apps/mobile/src/components/ui/share-button.tsx`) shares
a `villagefireside://...` deep link via React Native's `Share.share()`.
`app.json` has no `associatedDomains` (iOS) or `intentFilters`
(Android) for HTTPS universal links, and no hosted domain exists
anywhere in this project's configuration — confirmed by grepping the
whole repo. For a recipient without the app installed, a shared link is
inert text or a "no app found" error.

**Fix shape:** register a real domain, host
`.well-known/apple-app-site-association` and `assetlinks.json`, add
`associatedDomains`/`intentFilters` to `app.json`, and build a simple
"get the app" landing/redirect page for non-users — likely alongside a
future marketing-site effort.

**Severity:** Sharing works today for app-to-app use (an existing user
sharing with another existing user). Non-user recipients get a dead
link until the domain infrastructure above exists.
