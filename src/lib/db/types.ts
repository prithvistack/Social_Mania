/** Row shapes mirroring supabase/schema.sql. Pure types — safe to import anywhere. */

export type ChannelRow = {
  channel_id: string;
  title: string;
  handle: string | null;
  description: string;
  thumbnail: string;
  subscriber_count: number | null;
  video_count: number | null;
  topic_categories: string[];
  is_subscribed: boolean;
  rss_failed_at: string | null;
  fetched_at: string;
};

export type VideoRow = {
  id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  description: string;
  published_at: string;
  thumbnail: string;
  duration_seconds: number | null;
  is_short: boolean;
  view_count: number | null;
  like_count: number | null;
  tags: string[];
  category_id: string | null;
  topic_categories: string[];
  embeddable: boolean;
  stats_fetched_at: string | null;
  first_seen_at: string;
};

export type WatchHistoryRow = {
  id: number;
  video_id: string;
  channel_id: string;
  watched_at: string;
  seconds_watched: number;
  completed: boolean;
};

export type WatchLaterRow = { video_id: string; added_at: string };

export type PlaybackPositionRow = {
  video_id: string;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string;
};

export type PlaylistRow = {
  playlist_id: string;
  channel_id: string;
  channel_title: string;
  title: string;
  description: string;
  thumbnail: string;
  item_count: number;
  fetched_at: string;
};

export type PlaylistItemRow = {
  playlist_id: string;
  video_id: string;
  position: number;
  title: string;
};

export type CourseProgressRow = {
  playlist_id: string;
  started_at: string;
  reason: string;
  archived_at: string | null;
};

export type HandleResolutionRow = {
  handle: string;
  channel_id: string | null;
  resolved_at: string;
};

export type MentionEvidence = {
  video_id: string;
  video_title: string;
  channel_title: string;
  watched: boolean;
  published_at: string;
};

export type DiscoveredChannelRow = {
  channel_id: string;
  handle: string | null;
  title: string;
  thumbnail: string;
  description: string;
  category: string;
  score: number;
  evidence: MentionEvidence[];
  reason: string;
  dismissed: boolean;
  computed_at: string;
};

export type QuotaLogRow = {
  id: number;
  endpoint: string;
  units: number;
  outcome: "ok" | "error" | "refused";
  detail: string | null;
  created_at: string;
};

/**
 * The slice of the Supabase client the repos actually use. Narrowing it to
 * this makes the repos trivially fakeable in tests, with no network and no
 * Supabase project required.
 */
export type DbLike = {
  from: (table: string) => any;
  rpc: (fn: string, args?: Record<string, unknown>) => any;
};
