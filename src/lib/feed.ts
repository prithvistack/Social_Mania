import "server-only";

import { after } from "next/server";
import { SYNC_STATE_KEY, syncFeed, type SyncResult } from "./sync";
import { QuotaBudgetError } from "./quota";
import type { AppContext } from "./context";
import type { Video } from "./types";
import type { CourseSummary } from "./db/courses";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const FEED_TTL_SECONDS = num(process.env.FEED_TTL_SECONDS, 3600);
export const FEED_LIMIT = num(process.env.FEED_LIMIT, 400);

export type SortKey = "newest" | "views" | "likes";
const SORTS = new Set<SortKey>(["newest", "views", "likes"]);

export const parseSort = (value: string | undefined): SortKey =>
  SORTS.has(value as SortKey) ? (value as SortKey) : "newest";

export function sortVideos(videos: Video[], key: SortKey): Video[] {
  const copy = [...videos];
  if (key === "views") copy.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  else if (key === "likes") copy.sort((a, b) => (b.likeCount ?? -1) - (a.likeCount ?? -1));
  else
    copy.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
  return copy;
}

/**
 * Keeps the cache warm without ever making the reader wait for YouTube.
 *
 * On a cold cache there is nothing to show, so the sync runs inline. Once
 * there is a feed, a stale cache is refreshed by `after()` — the response goes
 * out immediately and the sync runs once it has been sent.
 */
function scheduleBackgroundSync(ctx: AppContext) {
  after(async () => {
    try {
      await syncFeed(ctx);
    } catch (err) {
      if (!(err instanceof QuotaBudgetError)) {
        console.error("Background feed sync failed:", err);
      }
    }
  });
}

/**
 * Keeps the cache warm without ever making the reader wait for YouTube.
 *
 * On a cold cache there is nothing to show, so the sync runs inline. Once
 * there is a feed, a stale cache is refreshed by `after()` — the response goes
 * out immediately and the sync runs once it has been sent.
 */
export async function ensureFeedFresh(ctx: AppContext): Promise<{
  cold: boolean;
  result?: SyncResult;
}> {
  const [syncState, cached] = await Promise.all([
    ctx.state.get<{ at?: string }>(SYNC_STATE_KEY),
    ctx.videos.count(),
  ]);

  if (cached === 0) {
    const result = await syncFeed(ctx);
    return { cold: true, result };
  }
  if (isSyncStale(syncState)) scheduleBackgroundSync(ctx);
  return { cold: false };
}

function isSyncStale(state: { at?: string } | null): boolean {
  if (!state?.at) return true;
  return Date.now() - new Date(state.at).getTime() > FEED_TTL_SECONDS * 1000;
}

export type FeedPage = {
  videos: Video[];
  channels: number;
  lastSyncedAt: string | null;
  watchLater: Set<string>;
  positions: Map<string, number>;
  courses: CourseSummary[];
};

/**
 * Everything the home page needs in two parallel waves of queries.
 *
 * The functions run in Mumbai beside the database, but every *sequential*
 * query is still a round trip the reader waits on, so nothing here waits on
 * anything it doesn't actually depend on.
 */
export async function getFeedPage(ctx: AppContext): Promise<FeedPage> {
  // Wave 1: none of these depend on each other.
  const [syncState, cached, channels, watchLater, positions, completed] = await Promise.all([
    ctx.state.get<{ at?: string }>(SYNC_STATE_KEY),
    ctx.videos.count(),
    ctx.videos.subscribedChannels(),
    ctx.watchLater.ids(),
    ctx.history.allPositions(),
    ctx.history.completedVideoIds(),
  ]);

  let channelIds = channels.map((c) => c.channel_id);
  let lastSyncedAt = syncState?.at ?? null;

  if (cached === 0) {
    // First ever visit: nothing to show until the feed is pulled.
    await syncFeed(ctx);
    channelIds = (await ctx.videos.subscribedChannels()).map((c) => c.channel_id);
    lastSyncedAt = new Date().toISOString();
  } else if (isSyncStale(syncState)) {
    scheduleBackgroundSync(ctx);
  }

  // Wave 2: the feed needs the channel list; courses need completed ids.
  const [videos, courses] = await Promise.all([
    ctx.videos.feed(FEED_LIMIT, { channelIds, lean: true }),
    ctx.courses.summaries(completed),
  ]);

  return {
    videos,
    channels: channelIds.length,
    lastSyncedAt,
    watchLater,
    positions,
    courses,
  };
}

/** Forces a sync now. Used by the Refresh button and /api/refresh. */
export async function refreshNow(ctx: AppContext): Promise<SyncResult> {
  return syncFeed(ctx, { force: true });
}

export type ChannelPage = {
  channel: Awaited<ReturnType<AppContext["videos"]["getChannel"]>>;
  videos: Video[];
  watchLater: Set<string>;
};

/**
 * A channel's catalogue from cache. RSS only carries ~15 uploads, so going
 * deeper uses the API — but only when the page is actually opened, and only
 * once, since everything fetched stays cached.
 */
export async function getChannelPage(
  ctx: AppContext,
  channelId: string,
  opts: { backfill?: boolean } = {},
): Promise<ChannelPage> {
  let channel = await ctx.videos.getChannel(channelId);
  let videos = await ctx.videos.channelVideos(channelId, 300);

  const needsChannel = !channel;
  const needsBackfill = opts.backfill !== false && videos.length < 30;

  if (needsChannel || needsBackfill) {
    try {
      if (needsChannel) {
        const detail = await ctx.client.getChannel(channelId);
        if (detail) {
          await ctx.videos.upsertChannels([
            {
              channel_id: detail.channelId,
              title: detail.title,
              handle: detail.handle ?? null,
              description: detail.description,
              thumbnail: detail.thumbnail,
              subscriber_count: detail.subscriberCount ?? null,
              video_count: detail.videoCount ?? null,
              topic_categories: detail.topicCategories ?? [],
            },
          ]);
          channel = await ctx.videos.getChannel(channelId);
        }
      }

      if (needsBackfill) {
        const uploads = await ctx.client.listUploads(channelId, 150);
        await ctx.videos.upsertFromRss(
          uploads.map((u) => ({
            videoId: u.videoId,
            channelId: u.channelId,
            channelTitle: u.channelTitle,
            title: u.title,
            description: u.description,
            publishedAt: u.publishedAt,
            thumbnail: u.thumbnail,
          })),
        );
        const missing = await ctx.videos.idsNeedingDetail(uploads.map((u) => u.videoId));
        if (missing.length > 0) {
          await ctx.videos.applyDetails(await ctx.client.listVideos(missing));
        }
        videos = await ctx.videos.channelVideos(channelId, 300);
      }
    } catch (err) {
      if (!(err instanceof QuotaBudgetError)) throw err;
      // Out of budget — the cached subset is still a usable page.
    }
  }

  return { channel, videos, watchLater: await ctx.watchLater.ids() };
}

/** Everything the watch page needs, in one pass. */
export async function getWatchData(ctx: AppContext, videoId: string) {
  let video = await ctx.videos.getVideo(videoId);

  if (!video || !video.durationSeconds) {
    try {
      const [fetched] = await ctx.client.listVideos([videoId]);
      if (fetched) {
        await ctx.videos.upsertChannels([
          { channel_id: fetched.channelId, title: fetched.channelTitle },
        ]);
        await ctx.videos.applyDetails([fetched]);
        video = fetched;
      }
    } catch (err) {
      if (!(err instanceof QuotaBudgetError)) throw err;
    }
  }
  if (!video) return null;

  const [pool, position, watchLater] = await Promise.all([
    ctx.videos.feed(FEED_LIMIT),
    ctx.history.getPosition(videoId),
    ctx.watchLater.ids(),
  ]);

  return { video, pool, position, watchLater };
}
