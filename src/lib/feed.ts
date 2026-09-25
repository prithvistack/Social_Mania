import { Store } from "./cache";
import type { ChannelDetail, Feed, Subscription, Video } from "./types";
import {
  QuotaMeter,
  fetchChannel,
  fetchSubscriptions,
  fetchUploads,
  fetchVideoById,
  hydrateVideos,
  mapLimit,
} from "./youtube";

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const TTL_SECONDS = num(process.env.FEED_TTL_SECONDS, 3600);
const VIDEOS_PER_CHANNEL = Math.min(50, num(process.env.FEED_VIDEOS_PER_CHANNEL, 10));
/** Upper bound on a channel page's catalogue, to keep one page from eating the quota. */
const CHANNEL_CATALOGUE_MAX = num(process.env.CHANNEL_CATALOGUE_MAX, 200);

const feedStore = new Store<Feed>("feed", TTL_SECONDS);
const channelStore = new Store<ChannelCatalogue>("channel", TTL_SECONDS * 6);

export type ChannelCatalogue = {
  channel: ChannelDetail | null;
  videos: Video[];
  fetchedAt: number;
};

async function buildFeed(token: string): Promise<Feed> {
  const meter = new QuotaMeter();
  const subscriptions = await fetchSubscriptions(token, meter);

  const failedChannels: string[] = [];
  const perChannel = await mapLimit(subscriptions, 6, async (sub) => {
    try {
      return await fetchUploads(sub, VIDEOS_PER_CHANNEL, token, meter);
    } catch {
      // A channel can be deleted, private, or have no uploads playlist.
      // One bad channel must not take the whole feed down with it.
      failedChannels.push(sub.title);
      return [] as Video[];
    }
  });

  const flat = perChannel.flat();
  const hydrated = await hydrateVideos(flat, token, meter);

  hydrated.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return {
    videos: hydrated,
    subscriptions,
    fetchedAt: Date.now(),
    failedChannels,
    quotaUnitsUsed: meter.used,
  };
}

export async function getFeed(token: string, opts: { force?: boolean } = {}) {
  return feedStore.resolve("me", () => buildFeed(token), opts);
}

/** The cached feed if there is one, without triggering a fetch. */
export async function peekFeed() {
  return feedStore.peek("me");
}

export async function invalidateFeed() {
  await feedStore.invalidate("me");
}

async function buildCatalogue(
  channelId: string,
  token: string,
): Promise<ChannelCatalogue> {
  const meter = new QuotaMeter();
  const channel = await fetchChannel(channelId, token, meter);
  const stub: Subscription = {
    channelId,
    title: channel?.title ?? "",
    thumbnail: channel?.thumbnail ?? "",
  };

  let videos: Video[] = [];
  try {
    videos = await fetchUploads(stub, CHANNEL_CATALOGUE_MAX, token, meter);
    videos = await hydrateVideos(videos, token, meter);
  } catch {
    // Channel has no public uploads playlist; the page still renders its header.
  }

  videos.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  return { channel, videos, fetchedAt: Date.now() };
}

export async function getChannelCatalogue(channelId: string, token: string) {
  return channelStore.resolve(channelId, () => buildCatalogue(channelId, token));
}

export type SortKey = "newest" | "views" | "likes";

export function sortVideos(videos: Video[], key: SortKey): Video[] {
  const copy = [...videos];
  if (key === "views") {
    copy.sort((a, b) => (b.viewCount ?? -1) - (a.viewCount ?? -1));
  } else if (key === "likes") {
    copy.sort((a, b) => (b.likeCount ?? -1) - (a.likeCount ?? -1));
  } else {
    copy.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
    );
  }
  return copy;
}

export const config = { VIDEOS_PER_CHANNEL, CHANNEL_CATALOGUE_MAX, TTL_SECONDS };

/**
 * Resolves a single video without spending quota when we can avoid it: the
 * cached feed first, then any cached channel catalogue, and only then the API.
 */
export async function getVideo(videoId: string, token: string): Promise<Video | null> {
  const cached = await feedStore.peek("me");
  const fromFeed = cached?.value.videos.find((v) => v.id === videoId);
  if (fromFeed) return fromFeed;
  return fetchVideoById(videoId, token);
}

/** The cached feed's videos, used as the candidate pool for related videos. */
export async function getRelatedPool(token: string): Promise<Video[]> {
  const cached = await feedStore.peek("me");
  if (cached) return cached.value.videos;
  // Nothing cached yet (cold start straight onto a watch URL) — build it, so
  // the sidebar still only ever draws from subscribed channels.
  const built = await getFeed(token);
  return built.value.videos;
}
