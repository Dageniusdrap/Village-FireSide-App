# Known Issues

Tracked gaps that are understood and deliberately deferred, not forgotten.
Each entry should carry enough context for the Prompt 20 final production
audit to triage it (fix, defer further, or accept) without re-deriving the
investigation.

## Mobile

### PRIORITY: Downloaded episodes keep playing after consent is revoked

From Prompt 15A, revoking an elder's `story_recording` consent moves every
affected published episode to `review` in the same database transaction,
so it disappears from the catalogue and can no longer be streamed. But
episodes already downloaded for offline listening are permanent local
files (`apps/mobile/src/lib/downloads-db.ts` plus the audio file). Nothing
ever re-checks them, so a listener who downloaded the episode keeps
playing it indefinitely.

This is a consent problem, not just a limitation: an elder who withdraws
consent has a reasonable expectation that their recording stops being
played. The Prompt 10 rule that downloads are permanent was written for
premium subscriptions lapsing, not for content being withdrawn.

**Fix shape:** at each sync (app start, return to the foreground, and when
connectivity returns, throttled), the app asks the server which of its
downloaded episode IDs are still published, and removes any download the
server confirms is not, using the existing `remove()` in
`download-queue-store.ts`. It must only delete on a successful server
response, never because a request failed or the device is offline. Sized in
the Prompt 15A spec ("Offline downloads after a revocation"). Not built in
15A.

**Severity:** High once real elder recordings are published and
downloadable. Should land before, or together with, the first real elder
testimony episode. Phones that never come back online keep the file
regardless; that residual gap can't be closed without DRM.

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

### Push tokens can't be verified until a development build exists

An EAS project now exists (`@dradriga/village-fireside`, created
2026-10-04), and its ID is in `app.json` under `extra.eas.projectId`, which
`apps/mobile/src/lib/push-token-registration.ts` already reads. That
removes the `ERR_NOTIFICATIONS_NO_EXPERIENCE_ID` failure this entry used to
describe.

Nothing has yet confirmed a real token reaching `push_tokens`, though.
Remote push doesn't work in Expo Go on Android, so it needs a development
build on a real device, and Android delivery also needs a Firebase project
with FCM credentials uploaded to EAS. Registration still fails silently
(try/catch) if anything is missing, and can also fail when the device is
offline.

**Fix shape:** create a Firebase project and upload its FCM credentials to
EAS, make an Android development build (`eas build --profile development`),
install it on a device, and confirm a row appears in `push_tokens`. Then
test delivery end to end with the Prompt 15 notification composer. (iOS
also needs a paid Apple Developer account.)

**Severity:** Blocks real push delivery, including the Prompt 15 composer,
until a development build and Firebase are set up. Deliberately deferred
to its own session.

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

### Admin test account has a weak password

The shared admin test account (`admin-test@villagefireside.app`, see
[test-accounts.md](test-accounts.md)) currently has a short, dictionary-style
password chosen for convenience during development. The value is
deliberately not recorded here — this repo is public — and lives only in
the gitignored `apps/admin/.env.local`. The admin role has full read/write
access to every table through `is_admin()`, and the account sits on the
live Supabase project (`dulratrptkkswvbbrffc`), so anyone who guesses the
password gets that access.

Separately, the project has no minimum password-strength policy, so
nothing stops the same thing happening to a real account.

**Fix shape:** before any real content or elder data (contributors,
consents, recordings) is added to the project:

1. Set a strong `TEST_ADMIN_PASSWORD` in `apps/admin/.env.local` and run
   `pnpm provision:test-accounts --reset-passwords` from `apps/admin`
   (this resets all three test accounts to their `.env.local` values).
2. In the Supabase dashboard, under Authentication → Policies, set a
   minimum password length and required character types, and consider
   enabling leaked-password protection.

**Severity:** Low while the project holds only test data. High the
moment real elder or contributor data is added — must be closed before
then, and before launch at the latest.

### The live Supabase project has no backups

The live project (`dulratrptkkswvbbrffc`, "village-fire-side") is on the
free plan. On 2026-10-04, `supabase backups list` returned an empty backup
list with point-in-time recovery off. If the database is lost or corrupted,
or a bad migration or mistaken delete runs against it, nothing can be
restored. That's acceptable for test data, and not acceptable for elder
recordings' consent records, signed agreements, and contributor details,
which can't be recreated.

The free plan also pauses projects after about a week without activity
(the account's three other projects all show `INACTIVE`). A paused project
takes the app offline until someone restores it from the dashboard.

**Fix shape:** before any real elder or consent data goes in, either:

1. move to a paid plan with daily backups (and decide whether
   point-in-time recovery is worth its extra cost), or
2. schedule a regular database export (for example a nightly `pg_dump`
   via `supabase db dump`, run from CI or another always-on machine),
   encrypted and stored off Supabase, with a tested restore.

Either way, the storage buckets (`audio-raw`, `audio-episodes`,
`consent-documents`) need their own backup: database backups don't
include storage objects. Signed consent agreements in particular exist
only there.

**Severity:** Low while the project holds only test data. A pre-real-data
requirement, alongside the weak admin password and the contributor-photo
signed URLs: must be in place before the first real elder or consent
record is added.

### Deleting an episode, series, or destination leaves its files in storage

`deleteEpisode`, `deleteSeries`, and `deleteDestination` (the `actions.ts`
files under `apps/admin/src/app/(dashboard)/`) delete only the database
row. Whatever files the row pointed to stay in storage indefinitely:

- the episode's audio in `audio-episodes` (confirmed in a browser QA run on
  2026-10-03: the episode row was gone, the `.m4a` object was not);
- the series or destination cover image in `images`;
- every gallery photo of a deleted destination: `destination_media` rows
  go via `on delete cascade`, but nothing removes their storage objects.
  Deleting a single gallery photo does clean up (`deleteDestinationMedia`).

The Prompt 14 spec only required storage cleanup for single gallery photos,
so this is a spec gap rather than an implementation bug. Orphaned files
in the public `images` bucket stay publicly reachable at their old URLs.

**Fix shape:** in each delete action, read the row's storage paths first
(`audio_url`; cover URL converted back to a path; every `destination_media`
URL for that destination), delete the row, then `storage.remove()` the
paths. Log a failed remove rather than failing the delete. Consider a
one-off sweep for objects no row references.

**Severity:** Low today (test data only). Grows with real content: wasted
storage, and public images left reachable after the content is removed.

### The CDN keeps serving deleted public images for up to an hour

Files in the public `images` bucket are served through Supabase's CDN with
`cache-control: public, max-age=3600`, the default since uploads don't set
`cacheControl`. In the 2026-10-03 QA run, a gallery photo deleted through
the admin UI was gone from storage (an uncached request returned 400), but
its public URL still returned 200 from the CDN (`cf-cache-status: HIT`).
A deleted image can stay reachable for up to an hour, and longer on any
device or proxy that cached it.

This matters most for contributor and elder photos: a photo removed
because consent was revoked, or hidden by setting `is_anonymous`, has to
stop being served promptly.

**Decision (2026-10-04):** contributor photos move to a private bucket and
are served through short-lived signed URLs, minted by a server-side function
that checks `is_anonymous` and the contributor's latest `photo` consent on
every request. Revoking consent or making a contributor anonymous then stops
new views immediately, and existing links expire within their TTL. Series
covers, destination covers and destination gallery photos have no personal
consent attached, so they stay in the public `images` bucket with the
default one-hour CDN caching.

**Fix shape:** built in Prompt 15A, which adds contributor photo upload. It
also changes the mobile screens that show contributor photos to fetch signed
links instead of reading a public URL. The orphaned-file cleanup above still
applies to the public images.

**Severity:** Low today (no real photos). Must be built before the first
real contributor photo is uploaded.

### Unpublishing an episode leaves `published_at` set

`unpublishEpisode` sets `status` back to `draft` but leaves `published_at`
at the original publish time (confirmed in the 2026-10-03 QA run). Anything
that treats a non-null `published_at` as "is published", or sorts drafts by
it, will be wrong, and re-publishing overwrites the original date with no
record of the first one.

**Fix shape:** decide what `published_at` means. If it is "currently
published since", clear it on unpublish. If it is "first published", keep
it but never overwrite it on re-publish. Then check every reader of the
column matches that meaning.

**Severity:** Low. Public visibility is decided by `status` (the episodes
RLS policy is `using (status = 'published')`), and the mobile app never
reads `published_at`.
