-- SocialMania / Quiet — Phase 2 schema
-- Paste this whole file into the Supabase SQL editor and run it.
-- Safe to re-run: every statement is idempotent.
--
-- This is a single-user app, so there are no user_id columns. Every table has
-- RLS enabled with NO policies, which denies all access to the anon and
-- authenticated keys. The server uses the service role key, which bypasses RLS
-- entirely. That combination means a leaked anon key exposes nothing.

do $$
begin
  create extension if not exists pg_trgm;
exception when others then
  raise notice 'pg_trgm unavailable (%), skipping the fuzzy-title index', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- Channels: every subscription, plus any channel discovered through mentions.
-- ---------------------------------------------------------------------------
create table if not exists channels (
  channel_id        text primary key,
  title             text not null default '',
  handle            text,
  description       text not null default '',
  thumbnail         text not null default '',
  subscriber_count  bigint,
  video_count       bigint,
  topic_categories  text[] not null default '{}',
  is_subscribed     boolean not null default false,
  -- Null until an RSS fetch fails and we fall back to the API path.
  rss_failed_at     timestamptz,
  fetched_at        timestamptz not null default now()
);

create index if not exists channels_subscribed_idx on channels (is_subscribed) where is_subscribed;
create index if not exists channels_handle_idx on channels (lower(handle));

-- ---------------------------------------------------------------------------
-- Immutable text[] -> text, for the search column below.
--
-- Generated columns may only use IMMUTABLE functions. array_to_string is
-- declared STABLE because, for arbitrary array types, it formats elements
-- through each type's output function. For text[] specifically that output is
-- deterministic, so pinning the signature to text[] makes IMMUTABLE honest.
-- search_path is fixed (and the call schema-qualified) so the result cannot
-- depend on the caller's settings; it also satisfies Supabase's linter.
-- ---------------------------------------------------------------------------
create or replace function immutable_array_to_string(arr text[], sep text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.array_to_string(arr, sep);
$$;

-- ---------------------------------------------------------------------------
-- Videos: the cache that makes almost everything else cost zero quota.
-- ---------------------------------------------------------------------------
create table if not exists videos (
  id                text primary key,
  channel_id        text not null references channels (channel_id) on delete cascade,
  channel_title     text not null default '',
  title             text not null default '',
  description       text not null default '',
  published_at      timestamptz not null,
  thumbnail         text not null default '',
  duration_seconds  integer,
  is_short          boolean not null default false,
  view_count        bigint,
  like_count        bigint,
  tags              text[] not null default '{}',
  category_id       text,
  topic_categories  text[] not null default '{}',
  embeddable        boolean not null default true,
  -- Null means "RSS gave us the row but videos.list has never enriched it".
  stats_fetched_at  timestamptz,
  first_seen_at     timestamptz not null default now(),

  -- Local full-text search. Weighted so a title hit outranks a description hit.
  search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', public.immutable_array_to_string(tags, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'C')
  ) stored
);

create index if not exists videos_published_idx on videos (published_at desc);
create index if not exists videos_channel_idx on videos (channel_id, published_at desc);
create index if not exists videos_search_idx on videos using gin (search_tsv);
-- Optional: only created when pg_trgm is available. Full-text search does not
-- depend on it.
do $$
begin
  create index if not exists videos_title_trgm_idx on videos using gin (title gin_trgm_ops);
exception when others then
  raise notice 'skipping videos_title_trgm_idx (%)', sqlerrm;
end $$;
create index if not exists videos_stale_stats_idx on videos (stats_fetched_at nulls first);

-- ---------------------------------------------------------------------------
-- Watch history
-- ---------------------------------------------------------------------------
create table if not exists watch_history (
  id              bigserial primary key,
  video_id        text not null,
  channel_id      text not null default '',
  watched_at      timestamptz not null default now(),
  seconds_watched integer not null default 0,
  -- True once the player reported >= 90% of the duration.
  completed       boolean not null default false
);

create index if not exists watch_history_watched_idx on watch_history (watched_at desc);
create index if not exists watch_history_video_idx on watch_history (video_id);
create index if not exists watch_history_channel_idx on watch_history (channel_id);

-- ---------------------------------------------------------------------------
-- Watch Later queue
-- ---------------------------------------------------------------------------
create table if not exists watch_later (
  video_id  text primary key,
  added_at  timestamptz not null default now()
);

create index if not exists watch_later_added_idx on watch_later (added_at desc);

-- ---------------------------------------------------------------------------
-- Resume points. One row per video; cleared once a video is ~95% done.
-- ---------------------------------------------------------------------------
create table if not exists playback_positions (
  video_id         text primary key,
  position_seconds integer not null default 0,
  duration_seconds integer,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Curated course playlists, cached 7 days.
-- ---------------------------------------------------------------------------
create table if not exists playlists (
  playlist_id   text primary key,
  channel_id    text not null default '',
  channel_title text not null default '',
  title         text not null default '',
  description   text not null default '',
  thumbnail     text not null default '',
  item_count    integer not null default 0,
  fetched_at    timestamptz not null default now()
);

create table if not exists playlist_items (
  playlist_id text not null references playlists (playlist_id) on delete cascade,
  video_id    text not null,
  position    integer not null default 0,
  title       text not null default '',
  primary key (playlist_id, video_id)
);

create index if not exists playlist_items_order_idx on playlist_items (playlist_id, position);

-- Enrollment only. Which lectures are finished is DERIVED from watch_history,
-- so clearing history correctly resets progress with no second bookkeeping.
create table if not exists course_progress (
  playlist_id text primary key references playlists (playlist_id) on delete cascade,
  started_at  timestamptz not null default now(),
  -- Free-text note from the assistant explaining why this course was suggested.
  reason      text not null default '',
  archived_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------

-- Permanent record of every handle we have ever resolved, INCLUDING failures
-- (channel_id null). This is what guarantees a handle is never re-resolved.
create table if not exists handle_resolutions (
  handle      text primary key,
  channel_id  text,
  resolved_at timestamptz not null default now()
);

create table if not exists discovered_channels (
  channel_id    text primary key,
  handle        text,
  title         text not null default '',
  thumbnail     text not null default '',
  description   text not null default '',
  category      text not null default 'Other',
  score         double precision not null default 0,
  -- [{ video_id, video_title, channel_title, watched, published_at }, ...]
  evidence      jsonb not null default '[]'::jsonb,
  reason        text not null default '',
  dismissed     boolean not null default false,
  computed_at   timestamptz not null default now()
);

create index if not exists discovered_score_idx on discovered_channels (score desc) where not dismissed;

-- ---------------------------------------------------------------------------
-- Quota ledger: one row per YouTube API call, ever.
-- ---------------------------------------------------------------------------
create table if not exists quota_log (
  id         bigserial primary key,
  endpoint   text not null,
  units      integer not null,
  -- 'ok' | 'error' | 'refused' (refused = blocked by the daily budget)
  outcome    text not null default 'ok',
  detail     text,
  created_at timestamptz not null default now()
);

create index if not exists quota_log_created_idx on quota_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Cached "Search all of YouTube" results, 24h.
-- ---------------------------------------------------------------------------
create table if not exists search_cache (
  query      text primary key,
  results    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Key/value scratch space for job bookkeeping (last discovery run, etc).
-- ---------------------------------------------------------------------------
create table if not exists app_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Quota usage for a UTC day, used by the budget indicator.
-- ---------------------------------------------------------------------------
create or replace function quota_used_since(since timestamptz)
returns bigint
language sql
stable
as $$
  select coalesce(sum(units), 0)::bigint
  from quota_log
  where created_at >= since and outcome = 'ok';
$$;

-- Local full-text search over the video cache.
create or replace function search_videos(q text, max_results integer default 50)
returns setof videos
language sql
stable
as $$
  select *
  from videos
  where search_tsv @@ websearch_to_tsquery('english', q)
  order by ts_rank(search_tsv, websearch_to_tsquery('english', q)) desc,
           published_at desc
  limit greatest(1, least(max_results, 200));
$$;

-- ---------------------------------------------------------------------------
-- Lock everything down. Service role bypasses RLS; no other key gets in.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'channels','videos','watch_history','watch_later','playback_positions',
    'playlists','playlist_items','course_progress','handle_resolutions',
    'discovered_channels','quota_log','search_cache','app_state'
  ]
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
