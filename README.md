# Quiet

A personal, distraction-free YouTube reader. It shows the uploads from the channels you
subscribe to, newest first, and nothing else. No recommendations, no trending, no
autoplay, no comments. An RSS reader for YouTube.

Single user by design: one Google account signs in, and everyone else is turned away.

---

## Setup

### 1. Get Google credentials

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library →** enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen →** choose **External**, fill in the app name
   and your email. Leave it in **Testing** mode and add your own Google account under
   **Test users**. (Testing mode is fine forever for a one-person app — you never need
   Google verification.)
4. Add the scope `https://www.googleapis.com/auth/youtube.readonly`.
5. **APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.** Add these authorised redirect URIs:

   ```
   http://localhost:3000/api/auth/callback/google
   https://<your-app>.vercel.app/api/auth/callback/google
   ```

### 2. Configure the environment

`.env.local` already exists with a generated `AUTH_SECRET`. Fill in the rest:

```bash
AUTH_GOOGLE_ID=...apps.googleusercontent.com
AUTH_GOOGLE_SECRET=...
ALLOWED_EMAIL=you@gmail.com
```

If you downloaded the `client_secret_*.json` from the Cloud Console, those two values
are the `web.client_id` and `web.client_secret` inside it. That file holds a live secret
and is gitignored.

`.env.local` is gitignored and never reaches the browser — every YouTube call happens in
a server component or a route handler, so no key or token is ever serialised to the client.

### 3. Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 23 tests, no network needed
npm run typecheck
npm run build
```

### 4. Deploy to Vercel

```bash
npx vercel
```

Then in **Project → Settings → Environment Variables** add `AUTH_GOOGLE_ID`,
`AUTH_GOOGLE_SECRET`, `NEXTAUTH_SECRET`, `ALLOWED_EMAIL`, and `NEXTAUTH_URL` set to your
deployment's URL (`https://<your-app>.vercel.app`). The free Hobby tier is enough.

---

## How it works

| Route | What it does |
| --- | --- |
| `/` | The feed. Every subscribed channel's recent uploads, reverse-chronological, grouped under Today / Yesterday / This week / month headings. |
| `/watch/[videoId]` | Embedded IFrame player plus the related-videos sidebar. |
| `/channel/[channelId]` | One channel's catalogue, sortable by newest, most viewed, or most liked. |
| `/subscriptions` | Every channel you follow, with when it last posted. |
| `/api/feed` | The cached feed as JSON, including what the last refresh cost in quota units. `?refresh=1` forces a rebuild. |
| `/api/refresh` | `POST` — drops the cache and rebuilds. |
| `/history` | Everything you've watched here, newest first. Delete one entry, a date range, or all of it. |
| `/later` | The Watch Later queue. Costs nothing — the metadata is already cached. |
| `/discover` | Channels your creators collaborate with or mention, grouped by category, each with a plain-language reason. |
| `/search` | Local full-text search over your cache. A separate button spends 100 units to search all of YouTube. |
| `/learn` | The learning assistant and your active courses. |
| `/digest` | Hours watched this week, by category and channel. |
| `/settings` | Quota usage, cache size, which model the assistant uses. |
| `/api/quota` | Today's spend, broken down by endpoint. |
| `/api/history/progress` | Receives playback position from the player. |
| `/api/search` | POST-only. The 100-unit search. |
| `/api/assistant` | POST-only. The learning assistant. |
| `/api/whoami` | Sign-in diagnostics: who is signed in, whether an access token reached the session, the scopes Google actually granted, and a live YouTube call proving the token works. Safe to delete once you trust the setup. |

### Shorts are included

Nothing is filtered. Shorts get a small badge (uploads of 60 seconds or less — the API
exposes no Shorts flag, so duration is the only signal), but they sit in the feed with
everything else.

### The player

The video plays in a YouTube IFrame on this site; there is no redirect to youtube.com.
It is configured with `rel=0` (end-of-video suggestions stay within the same channel —
YouTube stopped honouring full removal in 2018), `iv_load_policy=3` to kill annotation
overlays, and `modestbranding=1`. On top of that, the player calls `stopVideo()` when a
video ends, which replaces the end screen with a plain thumbnail.

If the uploader has disabled embedding, the page shows a direct YouTube link instead.
That is detected two ways: ahead of time from the API's `status.embeddable` field, and at
runtime from IFrame error codes 101 and 150.

### Related videos

The sidebar ranks candidates by TF-IDF cosine similarity over each video's title
(weighted ×3), tags (×2), and the first 400 characters of its description. The candidate
pool *is* the cached feed, so by construction a suggestion can only ever come from a
channel you already subscribe to. Extras: at most three results per channel so one
prolific creator can't fill the panel, a small boost for the channel being watched, and
a fallback to that channel's other uploads when nothing matches on keywords.

### Watch history and resume

The player reports progress every 15 seconds, on pause, on end, and on unload
via `sendBeacon` — `fetch` is cancelled during unload, so a beacon is the only
reliable path. Seconds watched are accumulated from play/pause ticks rather
than read off `currentTime`, so scrubbing around doesn't inflate the total, and
repeated pings within 30 minutes update one row instead of filling history with
duplicates. Anything under 10 seconds is treated as a misclick and not
recorded.

A video is **finished** at 90% watched, which is what course progress counts.
The resume point is dropped at 95%, because there is nothing left to resume.

**Deleting history cascades.** Removing an entry, a date range, or everything
also clears the resume points for videos that no longer appear in history at
all, the cached topic profile, and the Discover suggestions — whose reasons
quote specific watched videos. Course progress resets too, because it is
*derived* from history rather than stored separately, so there is no second
set of books to go stale. Channels you explicitly dismissed stay dismissed.
Clearing everything requires typing DELETE, so a stray POST can't wipe it.

### Discover

Discovery mines metadata that is already cached, so the scan itself is free.
It reads titles and descriptions for `@handles`, `youtube.com/@...` links,
`/channel/UC...` links, and podcast-style guest names ("… with Andrej
Karpathy", "Sholto Douglas | The Lunar Society", "Ep 42: …").

Extraction is deliberately conservative — `hello@example.com` is not the handle
`example`, `@ 12:34` is not a handle at all, and a bare Title Case phrase is
never guessed at as a guest without an explicit marker in front of it. There
are twenty tests pinning these cases.

Candidates are scored by how often they appear, weighted by whether you
actually **watched** the video that mentioned them (3x) and discounted by age.
An explicit handle or channel link outranks a guessed name. Anything you
already subscribe to, or have dismissed, is excluded.

The only paid step is turning a handle into a channel (`channels.list?forHandle`,
1 unit), capped at 40 per run — and **both hits and misses are recorded
permanently**, which is what makes "never re-resolve a known handle" true
rather than aspirational.

### The learning assistant

Ask it something like "I want to learn NLP" and it recommends a course. It
cannot recommend one that doesn't exist, and that is enforced in three layers:

1. It only ever sees playlists from the curated allowlist in
   [`src/config/learning-channels.ts`](src/config/learning-channels.ts) — edit
   that file to change what it can suggest.
2. Those playlists are **fetched from YouTube** (cached 7 days) and handed to
   the model as the catalogue. It is told, explicitly, that this is the only
   set of courses that exists.
3. Every pick it returns is checked against that catalogue by id before
   rendering. A hallucinated id — or one that is a single character off — is
   dropped and counted, never shown. Tests cover both.

Answering "nothing here fits" is treated as a correct answer, not a failure.
It runs on Gemini. The key is read server-side only; the model is configurable
via `GEMINI_MODEL` and defaults to `gemini-3.8-flash`. Responses are
constrained to a JSON schema at generation time and then validated again with
Zod, so a malformed or truncated reply fails loudly instead of half-rendering.

### Course progress

Starting a course records the enrollment and pulls the playlist's lecture list
once. Which lectures are done is computed from watch history at read time
(≥90% watched), so it stays correct with no bookkeeping of its own — and
clearing history resets it, as it should. The home page shows "7/19 lectures"
with a Continue button that opens the next unwatched lecture at its saved
position.

### Search

The default search is Postgres full-text over everything cached — your feed,
your history, your queue — with a weighted `tsvector` so a title match outranks
a description match. It costs nothing and runs on every keystroke-free form
submit.

"Search all of YouTube" is a separate button that prints its own price
(100 units) and only fires on click. Results are cached 24 hours per query, and
everything it finds is written into the local cache, so those videos become
searchable for free from then on.

### Weekly digest

Hours watched, a breakdown by category, top channels, and course progress —
computed entirely from Supabase, zero quota. Neutral by design: no streaks, no
goals, no badges. The only comparison is the previous seven days, stated
plainly.

### Caching and quota

The YouTube Data API allows 10,000 units per day. Phase 2 moves almost all feed
traffic off the API entirely.

**Uploads come from RSS.** Every channel publishes its recent uploads at
`youtube.com/feeds/videos.xml?channel_id=UC...`, which costs **zero quota** and
carries video id, title, publish time, thumbnail, description and view count.
The API is now touched only for what RSS cannot provide:

| What | Endpoint | Cost | How often |
| --- | --- | --- | --- |
| Uploads for every channel | RSS | **0** | every refresh |
| Subscription list | `subscriptions.list` | 1 per 50 subs | once a day |
| Duration, likes, tags, embeddability | `videos.list` | 1 per 50 **new** ids | only for ids never seen before |
| View-count refresh | `videos.list` | 1 per 50 | 100 stalest videos per refresh |
| RSS fallback for a failed channel | `playlistItems.list` | 1 | only when RSS fails |

Two caveats worth knowing about the RSS feed: it carries only the ~15 most
recent uploads (going deeper still uses the API, once, on the channel page),
and YouTube's **feed-level `<yt:channelId>` is missing the `UC` prefix** while
the per-entry one is correct. The parser trusts the entry-level id; there is a
regression test pinning that, because writing malformed channel ids into the
database would corrupt everything downstream.

#### What this costs, for 200 subscriptions

| | Phase 1 (`playlistItems` polling) | Phase 2 (RSS) |
| --- | --- | --- |
| Per hourly refresh | 244 units | **0-3 units** |
| Subscriptions | 4 units/refresh | 4 units/**day** |
| New-video detail | included above | ~1 unit/refresh when anything is new |
| Stats refresh | included above | 2 units/refresh |
| **Steady state per day** | **5,856** | **≈ 80** |

A cold start — the very first sync, with nothing cached — costs about **64
units** for 200 channels (4 for subscriptions, 60 to enrich 3,000 videos). The
sync tests assert both of these numbers directly: a cold sync of 200 channels
spends exactly 60 units on `videos.list`, and a warm sync with no new uploads
spends **zero**.

Per-feature costs on top of that:

| Feature | Cost | Notes |
| --- | --- | --- |
| Feed, history, Watch Later, digest, local search | **0** | pure Supabase reads |
| Discover | 1 unit per *new* @handle, ≤40 per run | handles are resolved once ever — hits *and* misses are recorded permanently, so a handle is never looked up twice. Runs at most once a day. |
| Channel page (first visit) | ~7 units | backfills ~150 uploads, then cached |
| Learning assistant | 1 unit per allowlisted channel per 7 days | playlists cached a week; ~8 units/week total |
| Start a course | 1-5 units, once | fetches the lecture list |
| **Search all of YouTube** | **100 units** | never automatic — only on an explicit click, and cached 24h per query |

#### The quota ledger

Every call to googleapis.com goes through one helper (`ledger.spend` in
[`src/lib/quota.ts`](src/lib/quota.ts)), which writes `{endpoint, units,
outcome, timestamp}` to `quota_log` and enforces `YT_DAILY_BUDGET` (default
8,000, below Google's 10,000 so a surprise never hard-fails). A test asserts
that all eight client methods produce exactly eight ledger rows — the log is a
complete record, not an estimate.

Three details that matter:

- **The day boundary is midnight Pacific**, not UTC or local, because that is
  when Google resets. Getting this wrong would either overrun the budget or
  refuse calls that are actually free.
- **Failed calls are billed at full price**, because Google charges for them.
  Under-counting failures is what causes overruns.
- **A refused call is logged at zero units and never made.** When the budget is
  nearly spent, background refreshes degrade to cached data rather than
  failing; a 500-unit reserve is held back so an explicit search you are
  waiting on still goes through.

Today's usage is shown as a thin bar in **Settings**, and `/api/quota` returns
the same figures broken down by endpoint.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_GOOGLE_ID` | yes | — | OAuth client ID. This exact name is required — next-auth v5 infers provider credentials from `AUTH_<PROVIDER>_ID` and recognises no alias. |
| `AUTH_GOOGLE_SECRET` | yes | — | OAuth client secret. Same naming rule. |
| `NEXTAUTH_SECRET` | yes | — | Session cookie encryption key (`openssl rand -base64 32`). `AUTH_SECRET` is the v5 name; both work. |
| `NEXTAUTH_URL` | on Vercel | — | Your deployment URL. `AUTH_URL` also works. |
| `ALLOWED_EMAIL` | recommended | — | The only account allowed to sign in. Unset means anyone with a Google account can. |
| `SUPABASE_URL` | yes | — | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | — | Service role key. Bypasses RLS, so it is read server-side only — see below. |
| `YT_DAILY_BUDGET` | no | `8000` | Daily YouTube unit budget. Google's hard cap is 10,000. |
| `GEMINI_API_KEY` | no | — | Enables the learning assistant. Without it, `/learn` says so. |
| `GEMINI_MODEL` | no | `gemini-3.8-flash` | Gemini model for the assistant |
| `YOUTUBE_API_KEY` | no | — | Optional API key for public reads. Same quota either way. |
| `FEED_TTL_SECONDS` | no | `3600` | How long the feed is cached |
| `FEED_VIDEOS_PER_CHANNEL` | no | `10` | Uploads pulled per channel per refresh (max 50) |
| `CHANNEL_CATALOGUE_MAX` | no | `200` | Cap on a channel page's catalogue |

---

## Layout

```
src/
  app/
    page.tsx              feed + courses in progress
    watch/[videoId]/      player, resume, related panel
    channel/[channelId]/  catalogue, sortable
    history/ later/ discover/ search/ learn/ digest/ settings/
    actions.ts            server actions (each re-verifies auth)
    api/                  feed, refresh, quota, search, assistant,
                          history/progress, auth, whoami
  lib/
    quota.ts       the ledger every YouTube call passes through
    rss.ts         zero-quota upload feeds
    sync.ts        RSS-first refresh pipeline
    youtube.ts     Data API v3 client (the only path to googleapis.com)
    mentions.ts    handle / channel / guest extraction  (pure)
    discovery.ts   the daily discovery job
    topics.ts      category derivation                  (pure)
    related.ts     TF-IDF similarity                    (pure)
    assistant.ts   Claude integration    (server-only)
    assistant-core.ts  the grounding guarantee          (pure)
    search.ts digest.ts feed.ts context.ts  (server-only)
    db/            client (server-only) + repos, injectable for tests
  config/
    learning-channels.ts   EDIT ME — the assistant's allowlist
supabase/
  schema.sql       paste into the Supabase SQL editor
tests/             102 tests, no network and no database required
```

## Security

Three things are load-bearing, and each is verified rather than assumed:

- **No key reaches the browser.** Every module touching Supabase, Gemini, or
  the YouTube token imports `server-only`, which turns a client-component
  import into a build failure rather than a runtime leak. Importing
  `lib/db/client` from a client component fails `next build` with exit code 1.
- **Every server action re-verifies the session.** Server Actions are reachable
  by direct POST regardless of which page renders them, so a page-level check
  does not protect them. Each action calls `getContext()` itself and validates
  its own inputs.
- **RLS is on with no policies.** Every table has row-level security enabled and
  zero policies, which denies the anon and `authenticated` keys entirely. Only
  the service role — server-side — gets in.



## Manual setup you have to do yourself

Everything below needs a human; nothing here can be scripted from inside the repo.

1. **Create a Supabase project** at [supabase.com](https://supabase.com) (the free
   tier is enough).
2. **Run the schema.** Open the project's **SQL Editor**, paste all of
   [`supabase/schema.sql`](supabase/schema.sql), and run it. It is idempotent, so
   re-running it later is safe.
3. **Copy two values** from **Project Settings → API** into `.env.local`:
   `SUPABASE_URL` (Project URL) and `SUPABASE_SERVICE_ROLE_KEY` (the
   `service_role` key, **not** `anon`).
4. **Optional — the learning assistant.** Create a key at
   [aistudio.google.com/apikey](https://aistudio.google.com/apikey) and set
   `GEMINI_API_KEY`. Without it everything else works and `/learn` says it
   isn't configured.
5. **Restart the dev server** so the new environment is picked up.
6. **Sign in and press Refresh.** The first sync backfills your whole feed
   (~64 units for 200 channels) and takes a minute or two. After that, refreshes
   are effectively free.
7. **Optional — edit the assistant's allowlist** in
   `src/config/learning-channels.ts`.

When you deploy, add the same variables in **Vercel → Settings → Environment
Variables**, and note that `/tmp` is not shared between serverless instances —
which is precisely why Phase 2 moved the cache into Supabase.

## Not included, on purpose

No accounts or multi-user support, no comments, no like or dislike buttons, no
notifications, no autoplay. No streaks, daily goals, or engagement mechanics of
any kind — the digest reports hours and stops there. No suggestion ever comes
from outside your subscriptions and the discovery rules above.
