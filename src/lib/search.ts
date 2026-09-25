import "server-only";

import { QUOTA_COSTS, QuotaBudgetError } from "./quota";
import type { AppContext } from "./context";
import type { Video } from "./types";

/** "Search all of YouTube" results are cached this long, per query. */
export const SEARCH_CACHE_TTL_MS = 24 * 3_600_000;
export const YOUTUBE_SEARCH_COST = QUOTA_COSTS["search.list"];

export type LocalHit = Video & {
  /** Where the match came from, so the UI can label it. */
  inHistory: boolean;
  inWatchLater: boolean;
};

export type LocalSearchResult = {
  query: string;
  hits: LocalHit[];
  counts: { feed: number; history: number; watchLater: number };
};

/**
 * The default search: Postgres full-text over everything cached, plus flags
 * for whether each hit is in watch history or the Watch Later queue.
 * Costs zero quota, always.
 */
export async function searchLocal(
  ctx: AppContext,
  query: string,
  limit = 60,
): Promise<LocalSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { query: trimmed, hits: [], counts: { feed: 0, history: 0, watchLater: 0 } };
  }

  const [videos, history, later] = await Promise.all([
    ctx.videos.search(trimmed, limit),
    ctx.history.list(1000),
    ctx.watchLater.ids(),
  ]);

  const watchedIds = new Set(history.map((h) => h.video_id));
  const hits: LocalHit[] = videos.map((v) => ({
    ...v,
    inHistory: watchedIds.has(v.id),
    inWatchLater: later.has(v.id),
  }));

  return {
    query: trimmed,
    hits,
    counts: {
      feed: hits.length,
      history: hits.filter((h) => h.inHistory).length,
      watchLater: hits.filter((h) => h.inWatchLater).length,
    },
  };
}

export type YouTubeSearchResult = {
  query: string;
  results: {
    videoId: string;
    title: string;
    channelId: string;
    channelTitle: string;
    publishedAt: string;
    thumbnail: string;
    description: string;
  }[];
  cached: boolean;
  unitsSpent: number;
};

/**
 * The 100-unit search. Never called automatically — only from an explicit
 * click — and every query's results are reused for 24 hours so pressing the
 * button twice costs nothing the second time.
 */
export async function searchYouTube(
  ctx: AppContext,
  query: string,
): Promise<YouTubeSearchResult> {
  const key = query.trim().toLowerCase();
  if (!key) return { query, results: [], cached: true, unitsSpent: 0 };

  const { data: cached } = await ctx.db
    .from("search_cache")
    .select("*")
    .eq("query", key)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached.created_at).getTime() < SEARCH_CACHE_TTL_MS) {
    return { query, results: cached.results ?? [], cached: true, unitsSpent: 0 };
  }

  const results = await ctx.client.searchVideos(query, 25);

  await ctx.db
    .from("search_cache")
    .upsert({ query: key, results, created_at: new Date().toISOString() }, { onConflict: "query" });

  // Everything found is worth caching — it makes these videos searchable
  // locally from now on, for free.
  if (results.length > 0) {
    await ctx.videos.upsertChannels(
      [...new Map(results.map((r) => [r.channelId, r])).values()].map((r) => ({
        channel_id: r.channelId,
        title: r.channelTitle,
      })),
    );
    await ctx.videos.upsertFromRss(
      results.map((r) => ({
        videoId: r.videoId,
        channelId: r.channelId,
        channelTitle: r.channelTitle,
        title: r.title,
        description: r.description,
        publishedAt: r.publishedAt,
        thumbnail: r.thumbnail,
      })),
    );
  }

  return { query, results, cached: false, unitsSpent: YOUTUBE_SEARCH_COST };
}

export { QuotaBudgetError };
