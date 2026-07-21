# Village Fireside â Complete Claude Code Build Prompt Pack

**Instructions for Claude Code, reading this file directly:**

This file contains 23 sequential build prompts for the Village Fireside
app (numbered 1, 2, 3, 3B, 4â21). Save this file as `docs/PROMPT_PACK.md`
in the project root if it isn't already there, and treat it as the source
of truth for the rest of this build â read it fresh before each prompt
rather than relying on memory or a summary of it.

Work through the prompts **in numeric order, one at a time**:

1. Implement exactly what the prompt's code block specifies.
2. After each prompt, run/build/test what was made and fix any errors
   before moving to the next prompt.
3. Commit to git after each completed prompt:
   `git add -A && git commit -m "Prompt N: <short description>"`.
4. Prompt 21 ("My Fireside") is explicitly marked POST-LAUNCH â do not
   build it until Prompts 1â20 are complete, tested, and the app has
   launched. Stop after Prompt 20 and wait for explicit confirmation
   before starting Prompt 21.
5. If a prompt references something built in an earlier prompt (e.g.
   Prompt 3B's app_settings toggle used in Prompt 7, or Prompt 4's
   edge function used in Prompt 8), check that dependency exists before
   proceeding â if it's missing, flag it rather than improvising a
   replacement.
6. If any prompt is ambiguous or a decision point comes up that isn't
   covered here, pause and ask rather than guessing â this is a real
   business with legal/consent implications (see Prompts 3 and 15), so
   silent assumptions are costly to undo.

**How a human uses this pack (for reference)**

1. Run the prompts **in order**, one at a time. Do not paste several at once.
2. After each prompt, test what was built before moving on. Fix errors with follow-up messages before starting the next prompt.
3. When Claude Code asks you a question, answer it â don't skip. If unsure, ask it to recommend the production-friendly option and explain why.
4. Prompts 1â5 build the foundation. Prompts 6â13 build the mobile app. Prompts 14â17 build the admin dashboard. Prompts 18â20 harden for launch. Prompt 21 is a post-launch v1.1 addition.
5. Commit to git after every completed prompt: `git add -A && git commit -m "Prompt N: <description>"`.

---

## Prompt 1 â Project Setup

```
Create a monorepo for a mobile audio storytelling app called "Village Fireside"
â an African tourism, nature, and history storytelling platform.
Tagline: "True African history, nature & stories â told by those who lived them"
App/bundle identifiers: com.villagefireside.app (Android applicationId and
iOS bundle identifier). Deep link scheme: villagefireside://

Structure:
- apps/mobile â Expo (React Native) app, TypeScript, Expo Router
- apps/admin â Next.js 14+ (App Router) admin dashboard, TypeScript, Tailwind
- packages/shared â shared TypeScript types and constants
- supabase/migrations â raw SQL migration files (we will NOT use Docker or
  local Supabase; migrations are applied via Supabase Studio SQL editor)
- docs/ â documentation

Mobile app dependencies: expo-router, react-native-track-player, zustand,
@supabase/supabase-js, expo-file-system, expo-image, nativewind,
react-native-maps, expo-notifications, react-native-svg.

Admin dependencies: @supabase/supabase-js, @supabase/ssr, tailwindcss,
react-hook-form, zod.

Set up:
- pnpm workspaces
- Shared ESLint + Prettier config
- .env.example files for both apps (SUPABASE_URL, SUPABASE_ANON_KEY;
  admin also gets SUPABASE_SERVICE_ROLE_KEY â server-side only, never
  exposed to the browser)
- .gitignore covering .env files, node_modules, build outputs
- docs/architecture.md explaining the structure and how the pieces connect
- Initialize git

Do not build features yet. Verify both apps start (expo start, next dev).
```

---

## Prompt 2 â Core Database Schema

```
Create the core database schema as raw SQL migration files in supabase/migrations/.
Use timestamped filenames in standard Supabase format.

Enums:
- user_role: listener, teacher, guide, admin
- episode_status: draft, review, published, archived
- access_tier: free, coins, premium
- content_language: en, lg, sw, fr, rw
- inquiry_status: new, contacted, closed
- transaction_type: coin_purchase, episode_unlock, subscription, refund

Tables:

profiles
- id UUID PK REFERENCES auth.users
- display_name, avatar_url (nullable), role user_role DEFAULT 'listener'
- country TEXT (nullable), coin_balance BIGINT DEFAULT 0
- is_premium BOOLEAN DEFAULT false, premium_expires_at TIMESTAMPTZ (nullable)
- created_at, updated_at

destinations
- id UUID PK, name, slug UNIQUE, description
- region, district, country TEXT
- latitude DOUBLE PRECISION, longitude DOUBLE PRECISION
- best_time_to_visit TEXT, entry_fee_notes TEXT, safety_notes TEXT,
  conservation_notes TEXT
- cover_image_url, is_published BOOLEAN DEFAULT false
- created_at, updated_at

series
- id UUID PK, title, slug UNIQUE, description, cover_image_url
- category TEXT (e.g. 'lakes', 'forests', 'wildlife', 'elder_history',
  'children', 'hidden_africa')
- destination_id UUID REFERENCES destinations (nullable)
- is_published BOOLEAN DEFAULT false, sort_order INT
- created_at, updated_at

episodes
- id UUID PK, series_id UUID REFERENCES series NOT NULL
- title, description, episode_number INT
- audio_url TEXT, duration_seconds INT
- status episode_status DEFAULT 'draft'
- access_tier access_tier DEFAULT 'free'
- coin_price BIGINT DEFAULT 0
- language content_language DEFAULT 'en'
- published_at TIMESTAMPTZ (nullable)
- created_at, updated_at
- UNIQUE (series_id, episode_number, language)

destination_media
- id UUID PK, destination_id REFERENCES destinations
- media_url, media_type TEXT CHECK (media_type IN ('image','video'))
- caption, sort_order INT

favorites
- user_id REFERENCES profiles, episode_id REFERENCES episodes (nullable),
  series_id REFERENCES series (nullable), destination_id REFERENCES
  destinations (nullable), created_at
- PK on (user_id, coalesce of target) â implement as separate columns with
  a CHECK that exactly one target is non-null and a partial unique index
  per target type

listening_progress
- user_id, episode_id, position_seconds INT, completed BOOLEAN DEFAULT false,
  updated_at, PK (user_id, episode_id)

unlocks
- user_id, episode_id, unlocked_at, PK (user_id, episode_id)

transactions
- id UUID PK, user_id, transaction_type, amount BIGINT,
  currency TEXT (nullable â coin transactions have no fiat currency),
  coins_delta BIGINT DEFAULT 0, reference TEXT (payment provider ref),
  episode_id (nullable), created_at

booking_inquiries
- id UUID PK, user_id (nullable â allow guest inquiries with contact info),
  destination_id REFERENCES destinations, name, phone, email (nullable),
  message TEXT, preferred_date DATE (nullable),
  status inquiry_status DEFAULT 'new', created_at

Money rule: all monetary amounts are BIGINT whole units with a currency
column where fiat is involved. Never floating point.

Indexes on: episodes(series_id, status), episodes(access_tier),
series(category, is_published), destinations(country, is_published),
listening_progress(user_id), transactions(user_id, created_at),
booking_inquiries(status).

Add updated_at triggers for all tables with updated_at.

RLS on every table:
- profiles: users read/update own row (cannot update coin_balance,
  is_premium, role â those change only via service role)
- destinations, series, episodes: public can SELECT only published rows;
  admin role full access
- favorites, listening_progress: owner only
- unlocks, transactions: owner can SELECT own; INSERT only via service role
- booking_inquiries: anyone can INSERT; only admin can SELECT/UPDATE

Write docs/schema.md and docs/rls-policies.md explaining every table
and policy in plain language.
```

---

## Prompt 3 â Contributors, Consent, and Education Schema

```
Add contributor, consent, and content-source tracking in a new migration
file in supabase/migrations/.

1. New enums:
- contributor_type: elder, voice_artist, writer, tour_guide, historian, translator
- consent_type: story_recording, voice_cloning, photo, video, translation, archive
- consent_status: granted, granted_with_conditions, declined, revoked
- content_source: elder_testimony, narrated_production, ai_assisted,
  tour_guide_original
- subject_area: history, biology, geography, culture, conservation, folklore
- grade_level: primary, o_level, a_level, tertiary, general

2. contributors table:
- id, full_name, display_name, is_anonymous BOOLEAN DEFAULT false,
  contributor_type, bio, photo_url (nullable), village, district, country,
  approximate_birth_year (nullable), phone (nullable),
  is_deceased BOOLEAN DEFAULT false, created_at, updated_at

3. consents table:
- id, contributor_id REFERENCES contributors, consent_type, consent_status,
  conditions TEXT, signed_date DATE, document_url (scan of signed agreement),
  witness_name (nullable), session_fee_amount BIGINT (nullable),
  session_fee_currency TEXT (nullable), fee_paid_date DATE (nullable), created_at

4. source_materials table (public domain books being narrated):
- id, title, author, publication_year, public_domain_verified BOOLEAN,
  verification_notes TEXT, source_url, created_at

5. Alter episodes, add:
- content_source content_source NOT NULL DEFAULT 'narrated_production'
- subject_area (nullable), grade_level (nullable), syllabus_topic TEXT (nullable)
- source_material_id REFERENCES source_materials (nullable)

6. episode_contributors junction:
- episode_id, contributor_id, role TEXT, PK (episode_id, contributor_id, role)

7. RLS:
- contributors, consents, source_materials: admin only. Consents, phone
  numbers, and fee amounts must never be publicly readable.
- Create VIEW public_contributors exposing only display_name, bio, photo_url,
  contributor_type, district, country â and for is_anonymous contributors,
  only display_name and contributor_type.

8. Document in docs/schema.md:
- Publishing rule: an episode with content_source = 'elder_testimony' must
  have >= 1 linked elder contributor with granted 'story_recording' consent.
  Enforced in admin dashboard.
- Episodes with content_source 'narrated_production' or 'ai_assisted' must
  show a "Narrated production" label in the app UI.

Indexes: contributors(contributor_type), consents(contributor_id, consent_type),
episodes(content_source), episodes(subject_area, grade_level),
episode_contributors(contributor_id).
```

---

## Prompt 3B â Cultural Groups ("Peoples & Kingdoms")

```
Add cultural group organization so stories can be browsed by the peoples
and kingdoms of Africa. New migration in supabase/migrations/:

- Table cultural_groups: id UUID PK, name, slug UNIQUE, description,
  country TEXT, region TEXT, cover_image_url,
  is_published BOOLEAN DEFAULT false, created_at, updated_at
- Junction table series_cultural_groups (series_id, cultural_group_id,
  PK on both)
- Junction table contributor_cultural_groups (contributor_id,
  cultural_group_id, PK on both)

App behavior (implement later with Prompts 7 and 12, note it in docs now):
- A "Peoples & Kingdoms" browse section on Home and a filter in the
  Learn tab
- Terminology rule: the UI always says "Peoples & Kingdoms" or
  "Cultures" â never "tribes"
- Per-country visibility: an app_settings key controls whether cultural
  group browsing is shown per country (default ON for Uganda, OFF for
  Rwanda, where ethnic categorization of content is legally sensitive).
  When OFF, the same content remains browsable by theme and region only.

RLS: public reads published groups only; admin full access.
Indexes on cultural_groups(country, is_published) and both junction
tables' second column. Update docs/schema.md.
```

Seed examples for Prompt 19: Buganda, Bunyoro-Kitara, Busoga, Acholi,
Ankole (Uganda).

---

## Prompt 4 â Storage Buckets & Media Pipeline

```
Create a migration and documentation for Supabase Storage:

Buckets:
- audio-episodes (private) â final episode audio. Served to the app via
  short-lived signed URLs only.
- audio-raw (private) â raw elder recordings archive. Admin only. Never
  publicly accessible.
- images (public) â covers, destination photos, contributor photos
- consent-documents (private) â scanned signed agreements. Admin only.

Storage policies:
- images: public read, admin write
- audio-episodes: no public read; admin write; access via signed URL
  generated server-side after checking the user's unlock/premium status
- audio-raw and consent-documents: admin only, both read and write

Create a Supabase Edge Function get-episode-audio:
- Input: episode_id, user JWT
- Logic: verify episode is published; if access_tier is 'free' OR user has
  an unlock row OR user is_premium â return a signed URL valid 6 hours;
  otherwise return 403 with a clear error code the app can handle
- Log each successful call into a plays table (create it: id, user_id
  nullable, episode_id, played_at) for basic analytics

Document the media pipeline in docs/media-pipeline.md:
- Audio uploaded as MP3 128kbps mono for speech (small files for African
  data costs), naming convention {series_slug}/{episode_number}-{lang}.mp3
- Images uploaded as WebP, max 1600px wide
```

---

## Prompt 5 â Authentication

```
Implement authentication end to end with Supabase Auth.

Mobile (apps/mobile):
- Email + password sign up / sign in, and phone OTP sign-in (important for
  East African users without email)
- Guest mode: users can browse and play FREE episodes without an account;
  favorites, progress sync, coins, and premium require sign-in â prompt
  gently at those moments, never block browsing
- On first sign-in, create the profiles row (via trigger on auth.users
  insert â add this trigger as a migration)
- Session persistence with expo-secure-store
- Auth screens: Welcome, Sign In, Sign Up, OTP verify, Forgot Password â
  simple, warm design, African nature imagery placeholders

Admin (apps/admin):
- Email/password sign-in only
- After sign-in, check profiles.role = 'admin'; otherwise show "Not authorized"
  and sign out
- Protect all admin routes with middleware

Testing: document in docs/auth.md how to create the first admin user
(SQL snippet to set role='admin' on a profile).
```

---

## Prompt 6 â Mobile App Shell, Theme & Navigation

```
Build the mobile app shell in apps/mobile with Expo Router.

Tab navigation (bottom tabs):
1. Home â discovery feed
2. Explore â map-based destination discovery
3. Learn â education mode (subjects/grades)
4. Library â favorites, downloads, listening history
5. Profile â account, coins, premium, settings

Theme:
- Warm African nature palette: deep forest green primary (#1F3B2C),
  earth/terracotta accent, warm off-white background, high contrast for
  outdoor readability
- Typography: readable serif for story titles, clean sans for UI
- Dark mode support
- Build a small design system in components/ui: Button, Card, Chip,
  SectionHeader, EpisodeRow (title, duration, lock/free badge, play button),
  SeriesCard (cover, title, category chip, episode count),
  DestinationCard (image, name, region), SourceBadge (shows "Elder testimony"
  in gold or "Narrated production" in neutral â this label is mandatory
  on every episode per docs/schema.md)

A persistent MiniPlayer bar above the tab bar appears whenever audio is
loaded (artwork, title, play/pause, tap to expand). Wire it to a zustand
player store (empty logic for now â Prompt 8 fills it).

Use mock data for now. All screens render without crashing.
```

---

## Prompt 7 â Home & Discovery

```
Build the Home tab with real Supabase data.

Sections (each horizontally scrollable):
1. Hero: featured series (admin-flagged â add is_featured BOOLEAN to series
   in a small migration)
2. "Voices of Our Elders" â series in category elder_history, visually
   distinct (gold accent, elder portrait covers)
3. Continue Listening â from listening_progress, resume at saved position
4. Category rails: Lakes, Forests, Wildlife, Hidden Africa, Children
5. "Peoples & Kingdoms" rail â published cultural_groups cards linking to
   a group screen (description, series, contributors from that group).
   Respect the per-country app_settings visibility toggle from Prompt 3B.
6. "Meet the Storytellers" â cards from public_contributors view (photo,
   name, district) linking to contributor profile screen

Series detail screen:
- Cover, title, description, category, destination link if set
- Episode list using EpisodeRow: free episodes playable instantly; locked
  episodes show coin price or premium badge
- Play All / Resume button
- Favorite toggle

Contributor profile screen:
- Photo (unless anonymous), display_name, bio, district/country
- List of episodes they contributed to
- Respect is_anonymous rules strictly

Loading skeletons, pull-to-refresh, empty states with friendly copy.
```

---

## Prompt 8 â Audio Player

```
Implement full audio playback with react-native-track-player.

- Playback service: play, pause, seek, skip Â±15s, next/previous episode
  in series, playback speed (0.8xâ2x)
- Background playback + lock screen / notification controls (Android & iOS
  config included)
- Audio URLs come from the get-episode-audio edge function (Prompt 4);
  handle 403 by showing the unlock sheet
- Full-screen Now Playing screen: artwork, series/episode title,
  SourceBadge (elder testimony vs narrated production), contributor name
  ("Told by Jajja Nakato of Masaka"), scrubber, controls, speed selector
- Save listening_progress every 15 seconds and on pause/close (only for
  signed-in users); mark completed at 95%
- When an episode ends: auto-play next episode if unlocked; if next is
  locked, show the unlock sheet
- MiniPlayer fully wired
- Handle interruptions (calls), audio focus, and offline file playback
  (local file path support â Prompt 10 uses this)
- Sleep timer: 10/20/30/45 min and "end of episode" â essential for the
  bedtime storytelling use case
- Bookmarks: user can bookmark a moment in an episode with an optional
  note; bookmarks list in Library (table episode_bookmarks: user_id,
  episode_id, position_seconds, note, created_at; RLS owner only)
- Position reliability is a TOP priority: losing playback position is the
  most-hated failure in audio apps. Persist position locally immediately
  on every pause/close/kill, sync to server when online, and on reopen
  always resume from the latest of local/server position.
```

---

## Prompt 9 â Coins, Unlocks & Premium

```
Implement the monetization flow.

Coin system:
- Profile screen shows coin balance
- Locked episode â Unlock Sheet: episode price in coins, "Unlock for X coins"
  button, or "Go Premium" upsell
- Unlocking: call a new edge function unlock-episode (episode_id + JWT).
  Server-side: check balance >= price, decrement coin_balance, insert unlocks
  row and transactions row atomically (use a Postgres function with a
  transaction). NEVER trust the client with balance math.
- Insufficient coins â coin purchase screen

Purchases (RevenueCat):
- Integrate react-native-purchases
- Products: coin packs (e.g. 100 / 500 / 1200 coins) and monthly premium
  subscription (unlimited listening)
- RevenueCat webhook â Supabase edge function revenuecat-webhook: on
  purchase events, credit coins or set is_premium/premium_expires_at, and
  insert transactions rows. Verify webhook signature.
- Free tier rule: first 3 episodes of every series are free by default
  (admin can override per episode)

Add a config table app_settings (key TEXT PK, value JSONB) for tunable
values like default free episode count.

Fairness rules (learned from top user complaints about competitor apps):
- Coins NEVER expire
- Unlocked episodes remain unlocked permanently, even if a premium
  subscription lapses
Document both rules in docs/monetization.md and reflect them in the code.
Document the whole money flow in docs/monetization.md, including how to
test with RevenueCat sandbox.
```

---

## Prompt 10 â Offline Downloads

```
Implement offline listening â critical for travel and low-connectivity areas.

- Download button on every unlocked/free episode and a "Download series" action
- Use expo-file-system; fetch a signed URL via get-episode-audio, download
  to app documents directory, store metadata (episode id, title, series,
  local path, file size, downloaded_at) in a local SQLite table
  (expo-sqlite) so the Library works fully offline
- Downloads screen in Library tab: list, storage used, delete individual /
  delete all
- Player checks local file first, streams only if not downloaded
- Download queue with progress indicators, pause/resume, retry on failure,
  and wifi-only toggle in settings (default ON to protect users' data bundles)
- Offline mode: when no connectivity, app opens straight to Library with a
  friendly offline banner; downloaded episodes fully playable; browsing
  screens show cached data where possible
- Security note in docs: downloaded files live in app sandbox; acceptable
  for v1, note DRM as a future option
```

---

## Prompt 11 â Explore Tab (Destinations & Map)

```
Build the Explore tab.

- Map view (react-native-maps) centered on East Africa with destination
  pins; clustering when zoomed out
- List/map toggle; filter chips by country and category
- Destination detail screen:
  - Image gallery from destination_media (images + short video clips)
  - Description, best time to visit, entry fees, safety notes,
    conservation notes
  - "Stories from this place" â linked series/episodes
  - Local contributors from this district (public_contributors)
  - "Plan Your Visit" button â Booking Inquiry form
- Booking Inquiry form: name, phone, email (optional), preferred date,
  message. Works for guests (no account needed). Inserts into
  booking_inquiries. Confirmation screen: "A local guide partner will
  contact you."
- Deep links: villagefireside://destination/{slug} and episode/series links,
  so stories can be shared to WhatsApp
```

---

## Prompt 12 â Learn Tab (Schools & Education)

```
Build the Learn tab for students and teachers.

Student view (default):
- Browse by subject_area (History, Biology, Geography, Culture,
  Conservation, Folklore) and grade_level
- Subject screens list episodes/series tagged with that subject; History
  gets a special "True African History" header featuring elder_testimony
  content first
- Syllabus topic chips (from episodes.syllabus_topic) for quick filtering
- Cultural group filter (from Prompt 3B) where enabled for the user's country

Teacher features (profiles.role = 'teacher'):
- "Request teacher account" flow: form (name, school, district, phone) â
  inserts into a new teacher_requests table (add migration; admin approves
  in dashboard, which sets role='teacher')
- Teachers can create Classes (new tables: classes {id, teacher_id, name,
  created_at} and class_assignments {class_id, episode_id, assigned_at})
  and share a class join code (class_members {class_id, user_id, joined_at})
- Students join with the code; teacher sees per-episode listen counts for
  their class (aggregate from listening_progress â counts only, never
  individual listening behavior outside assigned episodes)
- RLS: teachers see only their classes; students see only classes they
  joined; class member lists visible to the teacher only

Keep it minimal â this is the v1 school pilot feature set. Document in
docs/education.md.
```

---

## Prompt 13 â Search, Notifications & Polish

```
1. Global search (magnifier icon in header of every tab):
- Searches series titles, episode titles, destinations, and public
  contributor display names
- Use Postgres full-text search (add a migration with tsvector columns
  and GIN indexes on series, episodes, destinations)
- Recent searches stored locally; results grouped by type

2. Push notifications (expo-notifications):
- Notification permissions asked only after the user finishes their first
  episode (not on first launch)
- Notify on: new episode in a favorited series, teacher assignment (for
  class members)
- Store expo push tokens in a push_tokens table (migration + RLS: owner only)
- Sending happens from an admin dashboard action (Prompt 15) via edge function

3. Polish pass:
- Share buttons (episode/series/destination â WhatsApp-friendly links)
- Error boundaries and retry states on every data screen
- Haptics on key actions, smooth transitions
- Accessibility: labels on all controls, minimum touch targets 44pt
- App icon + splash screen placeholders with Village Fireside branding
```

---

## Prompt 13B â Daily Engagement: Today's Story, Streaks & Quizzes

```
Add proven engagement mechanics, kept culturally respectful.

1. "Tonight at the Fireside" (daily story):
- app_settings-driven daily featured episode; one hand-picked or rotated
  free episode per day, surfaced as a card at the top of Home with the
  day's date
- If the admin hasn't picked one, auto-rotate from published free episodes
- Push notification (opt-in, respects Prompt 13 rules) in the early
  evening: "Tonight at the Fireside: <episode title>"

2. Listening streaks (light touch):
- New table listener_streaks (user_id PK, current_streak INT,
  longest_streak INT, last_listen_date DATE)
- A day counts when the user completes >= 5 minutes of listening
  (update from the progress-saving path)
- One free "streak ember" per week auto-protects a single missed day
  (equivalent of a streak freeze)
- UI: small flame icon + count on Home and Profile; milestone toasts at
  7, 30, 100 days
- RULE: streaks and rewards must NEVER gate or gamify elder_testimony
  content itself â no "binge the elders" pressure. The streak rewards
  showing up, nothing else. Keep the visual treatment dignified.

3. Episode quizzes (Learn tab):
- New tables: quizzes (id, episode_id UNIQUE, is_published),
  quiz_questions (id, quiz_id, question, options JSONB (2-4 choices),
  correct_index INT, explanation TEXT, sort_order),
  quiz_attempts (user_id, quiz_id, score INT, total INT, completed_at)
- After finishing an episode that has a published quiz, show "Test
  yourself" (skippable); 3-5 questions, instant feedback with the
  explanation shown after each answer
- Teacher view (Prompt 12 classes): per-assignment aggregate quiz scores
  (class average and completion count only â never publicly ranking
  individual children)
- Admin dashboard: quiz builder on the episode edit page
- RLS: attempts owner-only; teachers see aggregates for their classes
  via a database function

4. docs/content-craft.md (writing guide, not code):
- Episode structure: hook in first 30 seconds, one story thread, end on
  a question or unresolved moment (cliffhanger) EXCEPT elder testimony,
  which ends naturally and respectfully
- Episode length targets: 8-15 min entertainment, 5-8 min Learn content
- Every Learn episode ships with its quiz
```

---

## Prompt 14 â Admin Dashboard: Content Management

```
Build the admin dashboard core in apps/admin (Next.js + Tailwind).

Layout: sidebar (Dashboard, Series, Episodes, Destinations, Contributors,
Consents, Source Materials, Inquiries, Teachers, Users, Settings),
top bar with admin name and sign out.

Series management:
- Table with search/filter; create/edit form (title, slug auto-generated,
  description, category, destination link, cover upload to images bucket,
  featured toggle, publish toggle)

Episode management:
- Create/edit: series, episode number, title, description, language,
  access tier + coin price, content_source, subject_area, grade_level,
  syllabus_topic, source_material link
- Audio upload to audio-episodes bucket with duration auto-detected
- Contributor linking UI: attach contributors with roles
- PUBLISHING GUARD: the Publish button runs validation â
  (a) audio file present, (b) if content_source = elder_testimony, at
  least one linked elder contributor with granted story_recording consent
  (query consents), otherwise block with a clear explanation,
  (c) title/description present. Show validation results before publishing.

Destination management:
- Create/edit with map pin picker (click map to set lat/lng), media
  gallery upload with drag-to-reorder, publish toggle

All writes go through server actions using the service role key
(never exposed client-side). Audit log table admin_actions (migration:
id, admin_id, action, entity_type, entity_id, details JSONB, created_at)
â log every create/update/publish/delete.
```

---

## Prompt 15 â Admin Dashboard: Contributors, Consents & Operations

```
Extend the admin dashboard.

Contributors:
- Table + create/edit (all fields, photo upload, anonymous toggle)
- Contributor detail page: profile, linked episodes, and their consents

Consents:
- Add consent from contributor page: type, status, conditions, signed date,
  witness, session fee amount/currency, fee paid date, and UPLOAD of the
  scanned signed agreement to consent-documents bucket
- Consent list view with filters (type, status); revoke action (sets status
  to revoked and flags any published episodes that depended on it for review)

Source materials:
- CRUD for public domain books: title, author, year, verified checkbox,
  verification notes, source URL. Warn if an episode links an unverified
  source material.

Inquiries:
- booking_inquiries table view, newest first, status workflow
  (new â contacted â closed), notes field

Teacher requests:
- Approve/reject; approval sets profiles.role = 'teacher' (server action,
  logged in admin_actions)

Dashboard home:
- Stat cards: total users, plays this week (plays table), top 5 episodes,
  new inquiries, pending teacher requests, coin revenue this month
  (transactions)
- Simple 30-day plays line chart

Notifications composer:
- Send a push notification (title + message) to: all users / favoriters of
  a series / a teacher's class â via an edge function using stored expo
  push tokens. Confirm before send; log in admin_actions.
```

---

## Prompt 16 â Payments Hardening & Mobile Money Groundwork

```
1. Review the full money path (RevenueCat webhook, unlock-episode function,
transactions table) and harden:
- Idempotency: webhook events and unlocks must be safe to receive twice
  (unique constraint on transactions.reference; ON CONFLICT DO NOTHING
  with correct handling)
- All balance changes inside Postgres functions with row locks
- transactions is append-only: no UPDATE/DELETE policies for anyone;
  corrections happen via compensating rows (refund type)

2. Mobile money groundwork (do NOT integrate a provider yet):
- payment_providers abstraction in code: interface with
  initiatePayment/verifyPayment/handleWebhook; RevenueCat implements it
- pending_payments table (migration): id, user_id, provider, amount BIGINT,
  currency, product_type, status (pending/confirmed/failed/expired),
  provider_reference, created_at, confirmed_at
- docs/mobile-money.md: integration plan for MTN MoMo and Airtel Money
  (flow: initiate â user approves on phone â webhook confirms â credit
  coins), what credentials will be needed, and sandbox testing notes

3. Fraud basics: rate-limit unlock-episode and coin-crediting paths;
alert (log) on a user gaining coins outside a verified transaction.
```

---

## Prompt 17 â Analytics & Content Insights

```
Lightweight, privacy-respecting analytics (no third-party trackers).

- Extend the plays table usage: log play_started, and add a
  play_events table (id, user_id nullable, episode_id, event TEXT
  CHECK (event IN ('started','completed','downloaded','shared','unlocked')),
  created_at) â write from app at those moments (guests logged with null
  user_id)
- Admin analytics page:
  - Plays and completions over time (7/30/90 day)
  - Completion rate per episode (completed/started) â the key content
    quality signal
  - Top series, top destinations by inquiry count, downloads count
    (proxy for travel intent)
  - Learn tab: plays by subject_area â shows what schools actually use
  - Elder content vs narrated production performance comparison
- Aggregate queries only; no admin screen ever shows an individual
  user's listening history
- docs/analytics.md: what each metric means and what decision it informs
```

---

## Prompt 18 â Security & RLS Audit

```
Full security audit. Go through every table, storage bucket, edge function,
and admin server action, and verify:

1. RLS is ENABLED on every table (list any without it)
2. Anonymous users can read ONLY: published destinations/series/episodes,
   public_contributors view, app_settings public keys â nothing else
3. No path allows a client to: change coin_balance, is_premium, role,
   insert unlocks/transactions, or read consents, phone numbers, fee
   amounts, other users' data
4. Storage: audio-episodes not publicly listable; consent-documents and
   audio-raw admin-only; signed URL expiry sensible
5. Edge functions: JWT verified, inputs validated (zod), rate limits,
   no service-role leakage in responses
6. Admin: every route checks role; service key server-side only;
   admin_actions logging complete
7. Secrets: nothing sensitive in the mobile bundle; .env files gitignored

Produce docs/security-audit.md: findings table (issue, severity, status),
then FIX every critical and high finding, then re-verify and update
the document. Write SQL test queries I can run as an anonymous user to
prove the sensitive data is inaccessible.
```

---

## Prompt 19 â Testing & Seed Data

```
1. Seed script (supabase/seed.sql + storage upload script):
- 4 destinations (Lake Bunyonyi, Bwindi Forest, Murchison Falls,
  Mabamba Wetland) with realistic details
- 4 series across categories including one elder_history series
  "Voices of Buganda"
- 16 episodes with mixed access tiers, languages, subject tags; use
  short placeholder MP3s
- 5 cultural groups (Buganda, Bunyoro-Kitara, Busoga, Acholi, Ankole)
  with series and contributors linked to them
- 3 contributors (one anonymous) with granted consents
- 1 source material (public domain book example)
- Test accounts: admin, teacher, listener (documented credentials)

2. Tests:
- Unit tests for the money logic (unlock, coin credit, idempotency) â
  these are the highest-risk paths
- Integration tests for edge functions (get-episode-audio access matrix:
  free/locked/unlocked/premium/guest)
- RLS tests: run the security-audit SQL checks as pgTAP tests or a
  script hitting the anon key
- Mobile: component tests for EpisodeRow lock states and the Unlock Sheet;
  a smoke test that the app boots and tabs render

3. docs/testing.md: how to run everything; manual test checklist for the
  flows automation can't cover (background audio, downloads offline,
  purchase sandbox, push notifications)
```

---

## Prompt 20 â Final Production Audit

```
Run a complete pre-launch audit and produce docs/launch-checklist.md with
PASS/FAIL per item. Fix all FAILs, then re-run.

App stores:
- expo prebuild/EAS build succeeds for Android and iOS
- App icons, splash, bundle IDs, versioning set
- Android: background audio permissions correct; iOS: audio background
  mode, App Tracking Transparency N/A confirmed
- Store listing requirements: privacy policy URL and terms (generate
  reasonable drafts in docs/legal/ â mark them for lawyer review),
  content rating questionnaire answers drafted
- In-app purchases configured and sandbox-tested (RevenueCat checklist)

Performance:
- Cold start < 3s on a mid-range Android device profile
- Images optimized (WebP, correct sizes); audio streaming starts < 2s
  on 3G simulation
- Bundle size reviewed; unused deps removed

Reliability:
- Crash reporting (Sentry) wired in mobile and admin
- All edge functions have error handling and structured logs
- Database: indexes verified against the actual query patterns;
  backup policy documented

Content readiness (manual items, list them for me):
- Minimum launch content bar: I recommend at least 3 complete series
  (one elder series), 12+ published episodes, 4 destination pages
- All published elder episodes pass the consent guard
- Every episode carries the correct SourceBadge

Business readiness (manual items, list them for me):
- Supabase production project created, migrations applied, seed removed
- RevenueCat production products approved
- Support email/WhatsApp set up and shown in app

Finish with a summary: remaining blockers (if any), and a recommended
soft-launch plan (country-limited release before wide launch).
```

---

## Prompt 21 â "My Fireside" (Family Recording) â POST-LAUNCH, v1.1

**Do not build this before launch.** Ship Prompts 1â20 first, launch, then
add this in the first major update. It is the app's biggest growth feature,
but launching without it keeps v1 focused.

```
Add "My Fireside" â users record their own elders and family stories,
modeled on the proven StoryCorps guided-interview pattern.

1. Guided recording:
- New "My Fireside" section in the Library tab
- Question prompt packs stored in a prompt_packs table (id, title,
  description, language) and prompts table (id, pack_id, question,
  sort_order) â seeded with packs like "Interview Your Grandmother",
  "Our Clan's Story", "Life in the Village Then", in en/lg/sw
- In-app recorder (expo-av): shows one prompt at a time, records answers
  as segments or one continuous recording; pause/resume; works fully
  offline, uploads when connected

2. Private family library:
- family_recordings table: id, owner_id, title, elder_name, relationship,
  language, audio_url (private bucket family-recordings), duration,
  created_at, visibility TEXT CHECK IN ('private','family','submitted')
- Sharing: owner can generate an invite link so family members can listen
  (family_recording_access: recording_id, user_id, granted_at)
- Storage quota: free users 60 minutes total, premium users 10 hours
  (enforced server-side; shown in UI)
- RLS: strictly owner + granted users. Admin can only access recordings
  with visibility='submitted'.

3. Submit to the Fireside:
- Owner can submit a recording for possible publication
- Submission flow explains clearly: the team will review, and NOTHING is
  published without a signed consent from the elder (links the existing
  consent process; admin converts accepted submissions into contributors
  + episodes via the normal pipeline)
- Admin dashboard: submissions queue (listen, accept â creates draft
  contributor + episode, decline with reason)
- Contributor credit: "Recorded by <user> with their grandmother <elder>"

4. Safety:
- Submitted recordings pass through the same publishing guard as all
  elder content (consent required)
- Report/flag mechanism on shared recordings
- Clear copy: private recordings belong to the family; the Project can
  only use recordings that are submitted AND consented

Update docs/education.md: schools can use My Fireside for "interview an
elder" homework â the strongest school engagement loop we have (modeled
on StoryCorps' Great Thanksgiving Listen).
```

---

## After the pack: suggested order of real-world work (not Claude Code)

1. Record your voice clone training audio (30â60 min clean speech).
2. Verify 2â3 public domain books and write your first corrective-framing scripts.
3. Run the first elder pilot: 5 elders, one district, signed agreements, cash fees paid same day.
4. Produce Series 1 ("Voices of ..." + one narrated history series).
5. Soft-launch in Uganda, approach 2 schools for a free pilot term.
6. Only then: sponsorships, tourism board conversations, diaspora marketing.
