import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  YouTubeAuthError,
  YouTubeQuotaError,
  createYouTubeClient,
  detailToVideo,
  parseDuration,
  uploadsPlaylistId,
} from "../src/lib/youtube.ts";
import { QuotaBudgetError, createQuotaLedger } from "../src/lib/quota.ts";
import { createFakeDb } from "./helpers/fakeDb.ts";

type Call = { url: URL; headers: Record<string, string> };
let calls: Call[] = [];

function mockApi(routes: Record<string, (url: URL) => unknown>, status = 200) {
  return (async (input: any, init: any) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const endpoint = url.pathname.split("/").pop()!;
    const handler = routes[endpoint];
    if (!handler) throw new Error(`unmocked endpoint: ${endpoint}`);
    return new Response(JSON.stringify(handler(url)), { status });
  }) as typeof fetch;
}

function harness(routes: Record<string, (url: URL) => unknown>, status = 200, budget = 8000) {
  const db = createFakeDb();
  const ledger = createQuotaLedger(db, { budget, reserve: 0 });
  const client = createYouTubeClient({
    token: "tok",
    ledger,
    fetchImpl: mockApi(routes, status),
  });
  return { db, ledger, client };
}

beforeEach(() => {
  calls = [];
  delete process.env.YOUTUBE_API_KEY;
});

test("parseDuration handles hours, minutes, seconds", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("P1DT2H"), 93600);
  assert.equal(parseDuration(undefined), undefined);
});

test("uploads playlist id swaps the UC prefix", () => {
  assert.equal(uploadsPlaylistId("UCabc123"), "UUabc123");
});

test("detailToVideo flags sub-minute uploads as Shorts", () => {
  const short = detailToVideo({ id: "a", contentDetails: { duration: "PT30S" } } as any);
  const long = detailToVideo({ id: "b", contentDetails: { duration: "PT10M" } } as any);
  assert.equal(short.isShort, true);
  assert.equal(long.isShort, false);
});

test("listSubscriptions pages and de-duplicates, logging one unit per page", async () => {
  const sub = (id: string, title: string) => ({
    snippet: { title, resourceId: { channelId: id }, thumbnails: { high: { url: "x" } } },
  });
  const pages = [
    { items: [sub("UC1", "Beta"), sub("UC2", "Alpha")], nextPageToken: "p2" },
    { items: [sub("UC2", "Alpha"), sub("UC3", "Gamma")] },
  ];
  let n = 0;
  const { db, client } = harness({ subscriptions: () => pages[n++] });

  const subs = await client.listSubscriptions();

  assert.deepEqual(subs.map((s) => s.title), ["Alpha", "Beta", "Gamma"]);
  assert.equal(calls[0].headers.Authorization, "Bearer tok", "subscriptions need OAuth");
  assert.equal(db.table("quota_log").length, 2, "one ledger row per page");
  assert.equal(
    db.table("quota_log").reduce((s, r) => s + r.units, 0),
    2,
  );
});

test("listVideos batches 50 ids per call and bills one unit each", async () => {
  const { db, client } = harness({
    videos: (url) => ({
      items: url.searchParams.get("id")!.split(",").map((id) => ({
        id,
        snippet: { title: `t-${id}`, tags: ["x"] },
        contentDetails: { duration: "PT10M" },
        statistics: { viewCount: "1000", likeCount: "10" },
        status: { embeddable: true },
      })),
    }),
  });

  const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
  const out = await client.listVideos(ids);

  assert.equal(out.length, 120);
  assert.equal(calls.length, 3, "120 ids => 3 requests");
  assert.equal(db.table("quota_log").length, 3);
  for (const call of calls) {
    assert.ok(call.url.searchParams.get("id")!.split(",").length <= 50);
  }
});

test("search.list is billed at 100 units", async () => {
  const { db, client } = harness({
    search: () => ({
      items: [{ id: { videoId: "abc" }, snippet: { title: "hit", thumbnails: {} } }],
    }),
  });

  const results = await client.searchVideos("neural networks");

  assert.equal(results[0].videoId, "abc");
  const row = db.table("quota_log")[0];
  assert.equal(row.endpoint, "search.list");
  assert.equal(row.units, 100);
});

test("a search is refused rather than blowing the budget", async () => {
  const db = createFakeDb({
    quota_log: [{ endpoint: "seed", units: 7950, outcome: "ok", created_at: new Date().toISOString() }],
  });
  const ledger = createQuotaLedger(db, { budget: 8000, reserve: 0 });
  const client = createYouTubeClient({
    token: "tok",
    ledger,
    fetchImpl: mockApi({ search: () => ({ items: [] }) }),
  });

  await assert.rejects(() => client.searchVideos("anything"), QuotaBudgetError);
  assert.equal(calls.length, 0, "no HTTP request is made when the budget refuses");
});

test("getChannelByHandle uses forHandle and costs one unit", async () => {
  const { db, client } = harness({
    channels: (url) => ({
      items: [{
        id: "UCresolved",
        snippet: { title: "Resolved", customUrl: "@someone", thumbnails: {} },
        statistics: { subscriberCount: "1000" },
      }],
    }),
  });

  const channel = await client.getChannelByHandle("someone");

  assert.equal(calls[0].url.searchParams.get("forHandle"), "@someone");
  assert.equal(channel?.channelId, "UCresolved");
  assert.equal(channel?.handle, "someone");
  assert.equal(db.table("quota_log")[0].units, 1);
});

test("an API key is used for public reads instead of the OAuth token", async () => {
  process.env.YOUTUBE_API_KEY = "KEY123";
  const { client } = harness({ videos: () => ({ items: [] }) });

  await client.listVideos(["v1"]);

  assert.equal(calls[0].url.searchParams.get("key"), "KEY123");
  assert.equal(calls[0].headers.Authorization, undefined, "no bearer token alongside the key");
});

test("a 401 becomes YouTubeAuthError and is still billed", async () => {
  const { db, client } = harness({ subscriptions: () => ({ error: "bad token" }) }, 401);
  await assert.rejects(() => client.listSubscriptions(), YouTubeAuthError);
  assert.equal(db.table("quota_log")[0].outcome, "error");
});

test("a quota 403 becomes YouTubeQuotaError", async () => {
  const { client } = harness(
    { subscriptions: () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }) },
    403,
  );
  await assert.rejects(() => client.listSubscriptions(), YouTubeQuotaError);
});

test("every client method routes through the ledger", async () => {
  const { db, client } = harness({
    subscriptions: () => ({ items: [] }),
    videos: () => ({ items: [] }),
    channels: () => ({ items: [] }),
    playlists: () => ({ items: [] }),
    playlistItems: () => ({ items: [] }),
    search: () => ({ items: [] }),
  });

  await client.listSubscriptions();
  await client.listVideos(["v1"]);
  await client.getChannel("UC1");
  await client.getChannelByHandle("someone");
  await client.listChannelPlaylists("UC1");
  await client.listPlaylistItems("PL1");
  await client.listUploads("UC1");
  await client.searchVideos("q");

  // Eight calls out, eight ledger rows — nothing reaches googleapis.com
  // without being counted.
  assert.equal(calls.length, 8);
  assert.equal(db.table("quota_log").length, 8);
  assert.deepEqual(
    db.table("quota_log").map((r) => r.endpoint),
    [
      "subscriptions.list", "videos.list", "channels.list", "channels.list",
      "playlists.list", "playlistItems.list", "playlistItems.list", "search.list",
    ],
  );
});
