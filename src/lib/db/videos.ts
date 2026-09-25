import type { ChannelRow, DbLike, VideoRow } from "./types";
import type { RssEntry } from "../rss";
import type { Subscription, Video } from "../types";

/** How long cached statistics stay good before a batched refresh. */
export const VIDEO_STATS_TTL_HOURS = 24;
/** Channel metadata barely changes; a week is plenty. */
export const CHANNEL_TTL_DAYS = 7;

export function rowToVideo(row: VideoRow): Video {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    channelId: row.channel_id,
    channelTitle: row.channel_title,
    publishedAt: row.published_at,
    thumbnail: row.thumbnail,
    durationSeconds: row.duration_seconds ?? undefined,
    isShort: row.is_short,
    viewCount: row.view_count ?? undefined,
    likeCount: row.like_count ?? undefined,
    tags: row.tags,
    embeddable: row.embeddable,
  };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type VideoRepo = ReturnType<typeof createVideoRepo>;

export function createVideoRepo(db: DbLike, now: () => Date = () => new Date()) {
  return {
    /**
     * Writes channel metadata. `is_subscribed` is stripped on purpose: channels
     * arrive from many places (discovery, the assistant's allowlist, YouTube
     * search), and any of them writing `false` would silently unsubscribe a
     * channel you follow. Only syncSubscriptions may set that flag. New rows
     * get the column default, false.
     */
    async upsertChannels(channels: Partial<ChannelRow>[]): Promise<void> {
      if (channels.length === 0) return;
      const rows = channels.map(({ is_subscribed: _ignored, ...rest }) => rest);
      for (const batch of chunk(rows, 200)) {
        await db.from("channels").upsert(batch, { onConflict: "channel_id" });
      }
    },

    /** Marks exactly the given channels as subscribed and everything else not. */
    async syncSubscriptions(subs: Subscription[]): Promise<void> {
      const stamp = now().toISOString();
      await this.upsertChannels(
        subs.map((s) => ({
          channel_id: s.channelId,
          title: s.title,
          thumbnail: s.thumbnail,
          fetched_at: stamp,
        })),
      );

      const ids = subs.map((s) => s.channelId);
      for (const batch of chunk(ids, 200)) {
        await db.from("channels").update({ is_subscribed: true }).in("channel_id", batch);
      }
      // Unsubscribing on YouTube should drop the channel out of the feed here.
      const { data } = await db.from("channels").select("channel_id").eq("is_subscribed", true);
      const stale = (data ?? [])
        .map((r: { channel_id: string }) => r.channel_id)
        .filter((id: string) => !ids.includes(id));
      if (stale.length > 0) {
        await db.from("channels").update({ is_subscribed: false }).in("channel_id", stale);
      }
    },

    async subscribedChannels(): Promise<ChannelRow[]> {
      const { data } = await db
        .from("channels")
        .select("*")
        .eq("is_subscribed", true)
        .order("title", { ascending: true });
      return (data ?? []) as ChannelRow[];
    },

    async getChannel(channelId: string): Promise<ChannelRow | null> {
      const { data } = await db
        .from("channels")
        .select("*")
        .eq("channel_id", channelId)
        .maybeSingle();
      return (data as ChannelRow) ?? null;
    },

    /**
     * Writes what RSS gave us. Duration, likes, tags and embeddability are
     * left null — `idsNeedingDetail` finds them for a single batched call.
     */
    async upsertFromRss(entries: RssEntry[]): Promise<void> {
      if (entries.length === 0) return;
      const rows = entries.map((e) => ({
        id: e.videoId,
        channel_id: e.channelId,
        channel_title: e.channelTitle,
        title: e.title,
        description: e.description,
        published_at: e.publishedAt,
        thumbnail: e.thumbnail,
        view_count: e.viewCount ?? null,
      }));
      for (const batch of chunk(rows, 200)) {
        await db.from("videos").upsert(batch, { onConflict: "id" });
      }
    },

    /** Which of these ids the cache has never enriched via videos.list. */
    async idsNeedingDetail(ids: string[]): Promise<string[]> {
      if (ids.length === 0) return [];
      const known = new Set<string>();
      for (const batch of chunk(ids, 300)) {
        const { data } = await db
          .from("videos")
          .select("id,stats_fetched_at")
          .in("id", batch);
        for (const row of data ?? []) {
          if (row.stats_fetched_at) known.add(row.id);
        }
      }
      return ids.filter((id) => !known.has(id));
    },

    /** Cached videos whose statistics have gone stale. */
    async idsWithStaleStats(limit = 200): Promise<string[]> {
      const cutoff = new Date(
        now().getTime() - VIDEO_STATS_TTL_HOURS * 3_600_000,
      ).toISOString();
      const { data } = await db
        .from("videos")
        .select("id")
        .lt("stats_fetched_at", cutoff)
        .order("published_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r: { id: string }) => r.id);
    },

    async applyDetails(videos: Video[]): Promise<void> {
      if (videos.length === 0) return;
      const stamp = now().toISOString();
      const rows = videos.map((v) => ({
        id: v.id,
        channel_id: v.channelId,
        channel_title: v.channelTitle,
        title: v.title,
        description: v.description,
        published_at: v.publishedAt,
        thumbnail: v.thumbnail,
        duration_seconds: v.durationSeconds ?? null,
        is_short: v.isShort ?? false,
        view_count: v.viewCount ?? null,
        like_count: v.likeCount ?? null,
        tags: v.tags ?? [],
        embeddable: v.embeddable ?? true,
        stats_fetched_at: stamp,
      }));
      for (const batch of chunk(rows, 200)) {
        await db.from("videos").upsert(batch, { onConflict: "id" });
      }
    },

    async getVideo(id: string): Promise<Video | null> {
      const { data } = await db.from("videos").select("*").eq("id", id).maybeSingle();
      return data ? rowToVideo(data as VideoRow) : null;
    },

    async getVideos(ids: string[]): Promise<Video[]> {
      if (ids.length === 0) return [];
      const out: Video[] = [];
      for (const batch of chunk(ids, 300)) {
        const { data } = await db.from("videos").select("*").in("id", batch);
        out.push(...(data ?? []).map((r: VideoRow) => rowToVideo(r)));
      }
      return out;
    },

    /** The reverse-chronological feed, straight from cache. Zero quota. */
    async feed(limit = 300): Promise<Video[]> {
      const channels = await this.subscribedChannels();
      const ids = channels.map((c) => c.channel_id);
      if (ids.length === 0) return [];

      const out: Video[] = [];
      for (const batch of chunk(ids, 100)) {
        const { data } = await db
          .from("videos")
          .select("*")
          .in("channel_id", batch)
          .order("published_at", { ascending: false })
          .limit(limit);
        out.push(...(data ?? []).map((r: VideoRow) => rowToVideo(r)));
      }
      out.sort(
        (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
      );
      return out.slice(0, limit);
    },

    async channelVideos(channelId: string, limit = 300): Promise<Video[]> {
      const { data } = await db
        .from("videos")
        .select("*")
        .eq("channel_id", channelId)
        .order("published_at", { ascending: false })
        .limit(limit);
      return (data ?? []).map((r: VideoRow) => rowToVideo(r));
    },

    /** Postgres full-text search over everything cached. Zero quota. */
    async search(query: string, limit = 50): Promise<Video[]> {
      const trimmed = query.trim();
      if (!trimmed) return [];
      const { data, error } = await db.rpc("search_videos", {
        q: trimmed,
        max_results: limit,
      });
      if (error) {
        // Fall back to a plain title match if the helper is missing.
        const { data: fallback } = await db
          .from("videos")
          .select("*")
          .order("published_at", { ascending: false })
          .limit(500);
        const needle = trimmed.toLowerCase();
        return (fallback ?? [])
          .filter((r: VideoRow) => r.title.toLowerCase().includes(needle))
          .slice(0, limit)
          .map((r: VideoRow) => rowToVideo(r));
      }
      return (data ?? []).map((r: VideoRow) => rowToVideo(r));
    },

    async count(): Promise<number> {
      const { count } = await db.from("videos").select("id", { count: "exact" });
      return count ?? 0;
    },
  };
}
