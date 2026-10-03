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

### Push token registration cannot succeed until an EAS project is configured

`apps/mobile/src/lib/push-token-registration.ts`'s `registerPushToken` calls
`Notifications.getExpoPushTokenAsync()`, which needs an EAS project ID —
either `app.json`'s `extra.eas.projectId` or a linked `eas.json` — neither
of which exists anywhere in this repo (confirmed by grepping the whole
repo). Until that infra exists, the call throws
`ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` every time; per the package's own doc
comment it can also reject when the device is offline, independent of the
EAS-config gap. `registerPushToken` and
`requestNotificationPermissionAndRegister` now wrap their bodies in
try/catch, so this fails silently (no unhandled-rejection warnings, no
crash) rather than surfacing to the user — but no token will ever reach the
`push_tokens` table until an EAS project is configured.

**Fix shape:** configure an EAS project (`eas init`, or manually set
`app.json`'s `extra.eas.projectId`), then verify `registerPushToken`
succeeds against a real device/build.

**Severity:** Low today (nothing sends real notifications yet). Blocks the
push-notification feature entirely until EAS is configured.

### Search results aren't ranked by relevance

`supabase/migrations/20260803100200_drop_search_vector_weighting.sql`
removes the `setweight(...)`-based title/description weighting that
`20260803100000_search_tsvector_columns.sql` originally built into
`series`, `episodes`, and `destinations`'s `search_vector` columns, because
`apps/mobile/src/hooks/queries/use-global-search.ts`'s `.textSearch(...)`
calls never ordered results by `ts_rank()` — PostgREST can't order by a
computed `ts_rank()` expression directly, so the weighting was dead code
implying a ranking guarantee that didn't actually exist. The schema now
honestly reflects what happens today: results within a type return in
whatever order Postgres's scan produces, unranked. With 5 or fewer matches
per type (the current `.limit(5)` on every query) this is invisible, but
once a type exceeds 5 matches, the best match isn't guaranteed to surface
first.

**Fix shape:** build a `SECURITY DEFINER` RPC (e.g. `search_series(query
text)`) that computes and orders by `ts_rank()` server-side, since
PostgREST can't do so directly, and switch `use-global-search.ts` to call
it instead of `.textSearch()`.

**Severity:** Low today (catalogue is small). Will degrade search UX as the
catalogue grows.

### Accessibility retrofit's `hitSlop` is a standardization, not a 44×44pt guarantee

Tasks 13-16's touch-target accessibility pass (extended in this fix round
to `ShareButton` and `search.tsx`, both added later in the branch than the
original task file lists accounted for) applies `hitSlop={Spacing.two}` (an
8pt expansion) to interactive `Pressable`s across the app. This
standardizes touch targets to a consistent expansion — it is not the same
thing as verifying every control meets a literal 44×44pt minimum. A small
control with an 8pt hitSlop can still fall short of 44×44pt depending on
its base rendered size. Noting this explicitly so a future contributor
doesn't assume 44pt compliance was verified when it wasn't.

**Fix shape:** if strict 44×44pt compliance is required (e.g. for an
accessibility audit), measure each control's rendered size + hitSlop and
adjust per-control rather than relying on the blanket `Spacing.two`
convention.

**Severity:** Low. Convention-consistent with the rest of the app; not a
regression.

### Cold-start notification tap likely won't deep-link correctly

`usePushNotificationListeners` (`apps/mobile/src/app/_layout.tsx:45`) is
called above the `loading || !fontsLoaded` early return
(`apps/mobile/src/app/_layout.tsx:106`), so a notification tap that
launches the app from a killed state can fire the response listener's
`router.push(...)` before `<Slot />` (and the whole `(app)` stack) has
mounted — and the route-guard effect can then `router.replace` over it once
loading resolves. Zero practical impact today, since nothing sends real
notifications until a future prompt builds the sender, but real once that
exists.

**Fix shape:** use `Notifications.useLastNotificationResponse()` (which
replays the launching response once navigation is ready) instead of, or in
addition to, `addNotificationResponseReceivedListener` for the cold-start
case.

**Severity:** None today (no real notifications sent yet). Will be a real
deep-link bug once the notification sender ships.

### No scheduled sender for the "Tonight at the Fireside" evening notification

Prompt 13B's "Tonight at the Fireside" makes a daily featured episode a
real, queryable fact (`daily_featured_episodes` plus deterministic
auto-rotation, in `apps/mobile/src/hooks/queries/use-todays-featured-episode.ts`),
but nothing sends the evening push notification the prompt pack
describes. No scheduler and no Prompt 15 admin-dashboard trigger exist
yet — the same gap Prompt 13 documented for its own push-notification
send path, for the same reason (Prompt 15's admin dashboard doesn't
exist yet). If/when a notification with an `episodeId` payload does
arrive, Prompt 13's existing tap-to-deep-link listener
(`apps/mobile/src/hooks/use-push-notification-listeners.ts`) already
handles it generically — no new client code is needed there.

**Fix shape:** needs a scheduled job (e.g. a cron-triggered edge
function) that reads today's featured episode and sends via the same
`push_tokens`-based mechanism Prompt 15 will build for its own sender —
likely built alongside Prompt 15 rather than as separate infrastructure.

**Severity:** Low today (no real notifications are sent for anything
yet). Becomes a real gap once Prompt 15's sender exists and this
feature is expected to use it.

## Backend / Database

### `revoke ... from public` does not revoke `anon`'s execute privilege on new functions

Supabase grants every new function its own default privileges via
`alter default privileges ... grant execute on functions to anon,
authenticated, service_role`, issued once at the project/schema level.
This gives `anon` a separate, explicit ACL entry on each function at
creation time — independent of the `public` pseudo-role. A migration's
`revoke all on function f(...) from public;` does not touch that entry,
so `anon` retains `EXECUTE` on the function even after the revoke,
unless a migration also runs `revoke execute on function f(...) from
anon;` explicitly.

This has caused a real bug twice within Prompt 13B alone: `record_listening_day`
(`supabase/migrations/20260922100100_listener_streaks_and_record_listening_day.sql`)
shipped with only the `from public` revoke, was caught in review, and
fixed with an explicit `from anon` revoke one migration later
(`20260922100105`). The very next migration in the same prompt,
`class_quiz_scores`
(`supabase/migrations/20260922100200_quizzes_and_class_quiz_scores.sql`),
reused the identical `from public`-only pattern and reintroduced the
same gap — not caught until the final whole-branch review, fixed in
`20260922100300`. Both occurrences had low practical impact (the
functions' own internal `auth.uid()`-based checks independently
excluded `anon` from any real data access), but the grant itself was
wrong both times, and a future security-definer function with a less
careful internal check could turn this into a real exposure.

**Fix shape:** grep the whole codebase for `revoke all on function` /
`revoke execute on function` during Prompt 18's security audit (the
planned automated RLS/privilege test harness) and confirm every
security-definer (or otherwise sensitive) function's migration includes
an explicit `revoke execute ... from anon`, not just `from public`.
Consider adding a lint/test check that fails a migration review if a
new function grants execute to `authenticated` without a matching
`anon` revoke, so this doesn't need to be caught by hand a third time.

**Severity:** Low today (both known occurrences are closed, and neither
ever allowed real data exposure). Worth auditing proactively since it's
an easy pattern to reintroduce and has already recurred once.

## Admin

### Destination media gallery has no video support

The `destination_media` table's `media_type` column supports `'video'`,
but the admin dashboard's media gallery (Prompt 14) only implements
image upload — video upload/preview is meaningfully more UI work than
images (no free inline `<img>`-style preview), and the prompt's own text
only said "media gallery upload" without calling out video specifically.

**Fix shape:** add a video file-type branch to `MediaGallery`'s upload
handler (`apps/admin/src/app/(dashboard)/destinations/media-gallery.tsx`)
and render an inline `<video>` preview instead of `<img>` when
`media_type = 'video'`.

**Severity:** Low. No destination currently needs video, and adding it
later is additive — no schema or existing-row migration needed.
