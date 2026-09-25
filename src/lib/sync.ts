import { QuotaBudgetError } from "./quota";
import { fetchChannelFeed, type RssEntry } from "./rss";
import { mapLimit } from "./youtube";
import type { VideoRepo } from "./db/videos";
import type { YouTubeClient } from "./youtube";
import type { Subscription } from "./types";

/** Subscriptions barely change; refetching them hourly would be pure waste. */
export const SUBSCRIPTION_TTL_MS = 24 * 3_600_000;
export const SYNC_STATE_KEY = "sync:last_run";
export const SUBS_STATE_KEY = "sync:subscriptions";

export type SyncResult = {
  channels: number;
  rssOk: number;
  rssFailed: string[];
  apiFallbacks: number;
  newVideos: number;
  hydrated: number;
  statsRefreshed: number;
  quotaUsed: number;
  degraded: boolean;
  notes: string[];
};

export type SyncDeps = {
  client: YouTubeClient;
  videos: VideoRepo;
  state: {
    isStale: (key: string, maxAgeMs: number) => Promise<boolean>;
    touch: (key: string, extra?: Record<string, unknown>) => Promise<void>;
  };
  ledger: { status: () => Promise<{ used: number }> };
  /** Swappable for tests. */
  fetchFeed?: typeof fetchChannelFeed;
  concurrency?: number;
};

/**
 * Refreshes the feed almost entirely for free.
 *
 * Each channel's uploads come from its RSS feed, which costs zero quota. The
 * API is touched only for:
 *   - the subscription list, at most once a day
 *   - videos.list on IDs the cache has never seen, batched 50 at a time
 *   - a playlistItems fallback for any channel whose RSS failed
 *
 * The previous implementation spent one playlistItems call per channel per
 * refresh, which is the 200-units-an-hour cost this removes.
 */
export async function syncFeed(deps: SyncDeps, opts: { force?: boolean } = {}): Promise<SyncResult> {
  const { client, videos, state, ledger } = deps;
  const fetchFeed = deps.fetchFeed ?? fetchChannelFeed;
  const before = (await ledger.status()).used;

  const result: SyncResult = {
    channels: 0,
    rssOk: 0,
    rssFailed: [],
    apiFallbacks: 0,
    newVideos: 0,
    hydrated: 0,
    statsRefreshed: 0,
    quotaUsed: 0,
    degraded: false,
    notes: [],
  };

  // --- 1. subscriptions (>= 1 unit, at most once a day) --------------------
  let channels = await videos.subscribedChannels();
  const subsStale = await state.isStale(SUBS_STATE_KEY, SUBSCRIPTION_TTL_MS);

  if (opts.force || subsStale || channels.length === 0) {
    try {
      const subs: Subscription[] = await client.listSubscriptions();
      await videos.syncSubscriptions(subs);
      await state.touch(SUBS_STATE_KEY, { count: subs.length });
      channels = await videos.subscribedChannels();
    } catch (err) {
      if (err instanceof QuotaBudgetError) {
        result.degraded = true;
        result.notes.push("Skipped the subscription refresh to stay inside the budget.");
      } else if (channels.length === 0) {
        throw err;
      } else {
        result.notes.push(`Subscription refresh failed: ${(err as Error).message}`);
      }
    }
  }

  result.channels = channels.length;
  if (channels.length === 0) return finish();

  // --- 2. RSS for every channel (zero units) -------------------------------
  const entries: RssEntry[] = [];
  const needsApiFallback: string[] = [];

  await mapLimit(channels, deps.concurrency ?? 8, async (channel) => {
    try {
      const feed = await fetchFeed(channel.channel_id);
      entries.push(...feed.entries);
      result.rssOk++;
    } catch {
      // Deleted channel, private uploads, or a transient RSS outage. The API
      // path below covers it rather than dropping the channel from the feed.
      result.rssFailed.push(channel.title || channel.channel_id);
      needsApiFallback.push(channel.channel_id);
    }
  });

  // --- 3. API fallback, only for channels RSS could not serve --------------
  for (const channelId of needsApiFallback) {
    try {
      const uploads = await client.listUploads(channelId, 10);
      result.apiFallbacks++;
      entries.push(
        ...uploads.map((u) => ({
          videoId: u.videoId,
          channelId: u.channelId,
          channelTitle: u.channelTitle,
          title: u.title,
          description: u.description,
          publishedAt: u.publishedAt,
          thumbnail: u.thumbnail,
        })),
      );
    } catch (err) {
      if (err instanceof QuotaBudgetError) {
        result.degraded = true;
        result.notes.push("Ran out of budget before the RSS fallbacks finished.");
        break;
      }
      // Genuinely unavailable — already counted in rssFailed.
    }
  }

  if (entries.length > 0) {
    // videos.channel_id is a foreign key, so the channel row has to exist
    // first. RSS carries the title, and one orphan would fail the whole
    // batch, so this runs unconditionally rather than only for new channels.
    const seen = new Map<string, string>();
    for (const entry of entries) {
      if (!seen.has(entry.channelId)) seen.set(entry.channelId, entry.channelTitle);
    }
    await videos.upsertChannels(
      [...seen].map(([channel_id, title]) => ({ channel_id, title })),
    );
    await videos.upsertFromRss(entries);
  }

  // --- 4. videos.list, new IDs only, 50 per call ---------------------------
  const allIds = [...new Set(entries.map((e) => e.videoId))];
  const missing = await videos.idsNeedingDetail(allIds);
  result.newVideos = missing.length;

  if (missing.length > 0) {
    try {
      const detailed = await client.listVideos(missing);
      await videos.applyDetails(detailed);
      result.hydrated = detailed.length;
    } catch (err) {
      if (err instanceof QuotaBudgetError) {
        result.degraded = true;
        result.notes.push(
          `${missing.length} new videos are showing without duration or tags until the budget resets.`,
        );
      } else {
        throw err;
      }
    }
  }

  // --- 5. refresh stale statistics, budget permitting ----------------------
  try {
    const stale = await videos.idsWithStaleStats(100);
    if (stale.length > 0) {
      const refreshed = await client.listVideos(stale);
      await videos.applyDetails(refreshed);
      result.statsRefreshed = refreshed.length;
    }
  } catch (err) {
    if (err instanceof QuotaBudgetError) {
      result.degraded = true;
      result.notes.push("View counts are a little stale; the budget is nearly spent.");
    }
    // Anything else here is non-fatal: stats are a nicety, not the feed.
  }

  await state.touch(SYNC_STATE_KEY, {
    channels: result.channels,
    newVideos: result.newVideos,
  });

  return finish();

  async function finish(): Promise<SyncResult> {
    result.quotaUsed = (await ledger.status()).used - before;
    return result;
  }
}
