import assert from "node:assert/strict";
import test from "node:test";
import { syncFeed, SUBS_STATE_KEY } from "../src/lib/sync.ts";
import { createQuotaLedger } from "../src/lib/quota.ts";
import { createVideoRepo } from "../src/lib/db/videos.ts";
import { createStateRepo } from "../src/lib/db/state.ts";
import { createYouTubeClient } from "../src/lib/youtube.ts";
import { createFakeDb } from "./helpers/fakeDb.ts";
import type { RssFeed } from "../src/lib/rss.ts";

const CHANNEL_COUNT = 200;
const VIDEOS_PER_CHANNEL = 15;

function channelId(i: number) {
  return `UC${String(i).padStart(22, "0")}`;
}

/** A deterministic stand-in for 200 channels' RSS feeds. Costs no quota. */
function makeFeeds(perChannel = VIDEOS_PER_CHANNEL, generation = 0) {
  return async (id: string): Promise<RssFeed> => ({
    channelId: id,
    channelTitle: `Channel ${id.slice(-3)}`,
    entries: Array.from({ length: perChannel }, (_, v) => ({
      videoId: `${id.slice(-4)}-g${generation}-v${v}`,
      channelId: id,
      channelTitle: `Channel ${id.slice(-3)}`,
      title: `Video ${v}`,
      description: "desc",
      publishedAt: new Date(Date.UTC(2026, 8, 1 + v)).toISOString(),
      thumbnail: `https://i.ytimg.com/vi/x/hqdefault.jpg`,
    })),
  });
}

function setup(opts: { channels?: number; subscribed?: boolean } = {}) {
  const count = opts.channels ?? CHANNEL_COUNT;
  const db = createFakeDb({
    channels: Array.from({ length: count }, (_, i) => ({
      channel_id: channelId(i),
      title: `Channel ${i}`,
      is_subscribed: true,
      thumbnail: "",
      description: "",
      topic_categories: [],
      fetched_at: new Date().toISOString(),
    })),
    // Pretend subscriptions were synced recently, so the daily call is skipped.
    app_state: opts.subscribed === false ? [] : [
      { key: SUBS_STATE_KEY, value: { at: new Date().toISOString() } },
    ],
  });

  let httpCalls = 0;
  const ledger = createQuotaLedger(db, { budget: 8000, reserve: 0 });
  const client = createYouTubeClient({
    token: "tok",
    ledger,
    fetchImpl: (async (input: any) => {
      httpCalls++;
      const url = new URL(String(input));
      const endpoint = url.pathname.split("/").pop();
      if (endpoint === "videos") {
        const ids = url.searchParams.get("id")!.split(",");
        return new Response(JSON.stringify({
          items: ids.map((id) => ({
            id,
            snippet: { title: `t-${id}`, channelId: "UCx", channelTitle: "C", publishedAt: "2026-09-01T00:00:00Z", tags: [] },
            contentDetails: { duration: "PT10M" },
            statistics: { viewCount: "100", likeCount: "5" },
            status: { embeddable: true },
          })),
        }));
      }
      if (endpoint === "subscriptions") {
        return new Response(JSON.stringify({
          items: Array.from({ length: count }, (_, i) => ({
            snippet: { title: `Channel ${i}`, resourceId: { channelId: channelId(i) }, thumbnails: {} },
          })),
        }));
      }
      if (endpoint === "playlistItems") {
        return new Response(JSON.stringify({ items: [] }));
      }
      return new Response(JSON.stringify({ items: [] }));
    }) as typeof fetch,
  });

  return {
    db,
    ledger,
    deps: {
      client,
      videos: createVideoRepo(db),
      state: createStateRepo(db),
      ledger,
      concurrency: 16,
    },
    httpCalls: () => httpCalls,
  };
}

const unitsUsed = (db: ReturnType<typeof createFakeDb>) =>
  db.table("quota_log").filter((r) => r.outcome === "ok").reduce((s, r) => s + r.units, 0);

test("a cold sync of 200 channels costs only the batched videos.list calls", async () => {
  const { db, deps } = setup();

  const result = await syncFeed({ ...deps, fetchFeed: makeFeeds() } as any);

  assert.equal(result.channels, CHANNEL_COUNT);
  assert.equal(result.rssOk, CHANNEL_COUNT, "every channel served by RSS");
  assert.equal(result.apiFallbacks, 0);
  assert.equal(result.newVideos, CHANNEL_COUNT * VIDEOS_PER_CHANNEL);

  // 3000 new videos / 50 per call = 60 units. Nothing else is spent.
  const used = unitsUsed(db);
  assert.equal(used, 60, `expected 60 units for a cold backfill, got ${used}`);
  assert.equal(db.table("videos").length, 3000);
});

test("a warm sync with no new uploads costs ZERO quota", async () => {
  const { db, deps } = setup();
  await syncFeed({ ...deps, fetchFeed: makeFeeds() } as any);
  const afterCold = unitsUsed(db);

  const result = await syncFeed({ ...deps, fetchFeed: makeFeeds() } as any);

  assert.equal(result.newVideos, 0);
  assert.equal(
    unitsUsed(db) - afterCold,
    0,
    "RSS alone covers a refresh when nothing new was published",
  );
});

test("only genuinely new video IDs are sent to videos.list", async () => {
  const { db, deps } = setup({ channels: 10 });
  await syncFeed({ ...deps, fetchFeed: makeFeeds(15, 0) } as any);
  const before = unitsUsed(db);

  // Each channel publishes one new video; the other 15 are already cached.
  const mixed = async (id: string) => {
    const old = await makeFeeds(15, 0)(id);
    const fresh = await makeFeeds(1, 1)(id);
    return { ...old, entries: [...fresh.entries, ...old.entries] };
  };

  const result = await syncFeed({ ...deps, fetchFeed: mixed } as any);

  assert.equal(result.newVideos, 10, "10 channels x 1 new video");
  assert.equal(unitsUsed(db) - before, 1, "10 new ids fit in a single 50-id batch");
});

test("a channel whose RSS fails falls back to the API and is counted", async () => {
  const { db, deps } = setup({ channels: 3 });

  const flaky = async (id: string) => {
    if (id === channelId(1)) throw new Error("RSS 404");
    return makeFeeds(2)(id);
  };

  const result = await syncFeed({ ...deps, fetchFeed: flaky } as any);

  assert.equal(result.rssOk, 2);
  assert.equal(result.rssFailed.length, 1);
  assert.equal(result.apiFallbacks, 1, "the API covers the channel RSS could not");
  assert.ok(
    db.table("quota_log").some((r) => r.endpoint === "playlistItems.list"),
    "the fallback is billed through the ledger like everything else",
  );
});

test("the subscription list is fetched when stale and skipped when fresh", async () => {
  const cold = setup({ channels: 5, subscribed: false });
  await syncFeed({ ...cold.deps, fetchFeed: makeFeeds(1) } as any);
  assert.ok(
    cold.db.table("quota_log").some((r) => r.endpoint === "subscriptions.list"),
    "a cold start must fetch subscriptions",
  );

  const warm = setup({ channels: 5 });
  await syncFeed({ ...warm.deps, fetchFeed: makeFeeds(1) } as any);
  assert.ok(
    !warm.db.table("quota_log").some((r) => r.endpoint === "subscriptions.list"),
    "a sync within 24h must not re-fetch subscriptions",
  );
});

test("the sync degrades to cached data instead of failing when the budget runs out", async () => {
  const { db, deps } = setup({ channels: 20 });
  // Burn almost the whole budget before syncing. Inserted through the query
  // builder so it actually lands in the store.
  await db.from("quota_log").insert({
    endpoint: "seed", units: 7999, outcome: "ok", created_at: new Date().toISOString(),
  });

  const result = await syncFeed({ ...deps, fetchFeed: makeFeeds(15) } as any);

  assert.equal(result.degraded, true);
  assert.ok(result.notes.length > 0, "the user is told why the feed looks thin");
  // RSS still ran, so the videos are in the cache even without detail.
  assert.equal(db.table("videos").length, 300, "RSS data lands regardless of budget");
});

test("RSS rows land even before videos.list enriches them", async () => {
  const { db, deps } = setup({ channels: 2 });
  await syncFeed({ ...deps, fetchFeed: makeFeeds(3) } as any);

  const video = db.table("videos")[0];
  assert.ok(video.title, "title comes from RSS");
  assert.ok(video.published_at, "publish date comes from RSS");
  assert.ok(video.stats_fetched_at, "and videos.list filled in the rest");
});
