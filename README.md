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

### Caching and quota

The YouTube Data API allows 10,000 units per day. The feed is cached in module memory and
mirrored to `/tmp`, which survives a warm serverless instance being reused. Cold starts
simply refetch. A refresh happens on the first page view after `FEED_TTL_SECONDS` (one
hour by default) has lapsed; concurrent readers share a single refetch, and if a refresh
fails the stale feed is served rather than an empty page.

Two things keep the cost down. Uploads playlist IDs are derived from the channel ID by
swapping the `UC` prefix for `UU`, which avoids a `channels.list` call per channel on
every refresh. And video detail — duration, view and like counts, tags, embeddability —
is fetched 50 videos per request.

One refresh costs `ceil(N/50) + N + ceil(N×V/50)` units, for `N` subscriptions and `V`
videos per channel. Refreshing hourly, at the default `V=10`:

| Subscriptions | Per refresh | Per day (24 refreshes) |
| --- | --- | --- |
| 100 | 122 | 2,928 |
| 200 | 244 | 5,856 |
| 300 | 366 | 8,784 |
| 400 | 488 | 11,712 — **over budget** |

Past roughly 350 channels, raise `FEED_TTL_SECONDS` to `7200` for a two-hour refresh, or
lower `FEED_VIDEOS_PER_CHANNEL`. Watch `/api/feed` to see the real number — it reports
`quotaUnitsUsed` for the last rebuild.

Channel pages are cached for six hours and cost about 9 units each.

### Why there's no cron job

Refreshing on a schedule would need the OAuth refresh token available outside a request,
and it lives only in the encrypted session cookie. Adding a real store for it would mean
a database, which this deliberately doesn't have. The TTL achieves the same freshness:
the first visit after an hour pays for the refresh. The **Refresh** button in the header
forces one immediately.

---

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AUTH_GOOGLE_ID` | yes | — | OAuth client ID. This exact name is required — next-auth v5 infers provider credentials from `AUTH_<PROVIDER>_ID` and recognises no alias. |
| `AUTH_GOOGLE_SECRET` | yes | — | OAuth client secret. Same naming rule. |
| `NEXTAUTH_SECRET` | yes | — | Session cookie encryption key (`openssl rand -base64 32`). `AUTH_SECRET` is the v5 name; both work. |
| `NEXTAUTH_URL` | on Vercel | — | Your deployment URL. `AUTH_URL` also works. |
| `ALLOWED_EMAIL` | recommended | — | The only account allowed to sign in. Unset means anyone with a Google account can. |
| `YOUTUBE_API_KEY` | no | — | Optional API key for public reads. Same quota either way. |
| `FEED_TTL_SECONDS` | no | `3600` | How long the feed is cached |
| `FEED_VIDEOS_PER_CHANNEL` | no | `10` | Uploads pulled per channel per refresh (max 50) |
| `CHANNEL_CATALOGUE_MAX` | no | `200` | Cap on a channel page's catalogue |

---

## Layout

```
src/
  app/
    page.tsx                    feed
    watch/[videoId]/page.tsx    player + related
    channel/[channelId]/page.tsx
    subscriptions/page.tsx
    signin/page.tsx
    actions.ts                  server actions (sign in/out, refresh)
    api/{feed,refresh,auth}/
  lib/
    auth.ts        Google OAuth, refresh-token rotation, single-account gate
    youtube.ts     Data API v3 client with quota metering
    cache.ts       TTL store, single-flight, stale-on-error
    feed.ts        feed + channel catalogue orchestration
    related.ts     TF-IDF similarity
    format.ts      dates, durations, counts
  components/
tests/             23 tests over ranking, API wiring, and caching
```

## Not included, on purpose

No accounts or multi-user support, no comments, no like or dislike buttons, no watch
history, no notifications.
