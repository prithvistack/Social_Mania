import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  QuotaMeter,
  YouTubeAuthError,
  YouTubeQuotaError,
  fetchSubscriptions,
  fetchUploads,
  hydrateVideos,
} from "../src/lib/youtube.ts";

type Call = { url: URL; headers: Record<string, string> };
let calls: Call[] = [];

/** Stands in for the YouTube Data API so the client can be exercised offline. */
function mockApi(routes: Record<string, (url: URL) => unknown>, status = 200) {
  globalThis.fetch = (async (input: any, init: any) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const endpoint = url.pathname.split("/").pop()!;
    const handler = routes[endpoint];
    if (!handler) throw new Error(`unmocked endpoint: ${endpoint}`);
    const body = handler(url);
    return new Response(JSON.stringify(body), { status });
  }) as any;
}

beforeEach(() => {
  calls = [];
  delete process.env.YOUTUBE_API_KEY;
});

const sub = (id: string, title: string) => ({
  snippet: { title, resourceId: { channelId: id }, thumbnails: { high: { url: `${id}.jpg` } } },
});

test("fetchSubscriptions pages through results and de-duplicates", async () => {
  const pages = [
    { items: [sub("UC1", "Beta"), sub("UC2", "Alpha")], nextPageToken: "p2" },
    { items: [sub("UC2", "Alpha"), sub("UC3", "Gamma")] },
  ];
  let n = 0;
  mockApi({ subscriptions: () => pages[n++] });

  const meter = new QuotaMeter();
  const subs = await fetchSubscriptions("tok", meter);

  assert.deepEqual(subs.map((s) => s.title), ["Alpha", "Beta", "Gamma"]);
  assert.equal(meter.used, 2, "one unit per page");
  assert.equal(calls[0].url.searchParams.get("mine"), "true");
  assert.equal(calls[0].url.searchParams.get("maxResults"), "50");
  assert.equal(calls[1].url.searchParams.get("pageToken"), "p2");
  assert.equal(calls[0].headers.Authorization, "Bearer tok", "subscriptions need OAuth");
});

test("fetchUploads reads the derived uploads playlist", async () => {
  mockApi({
    playlistItems: (url) => ({
      items: [
        {
          snippet: {
            title: "Ep 1",
            description: "d",
            channelId: "UCabc",
            videoOwnerChannelId: "UCabc",
            videoOwnerChannelTitle: "Chan",
            channelTitle: "Chan",
            thumbnails: { medium: { url: "t.jpg" } },
            resourceId: { videoId: "v1" },
          },
          contentDetails: { videoId: "v1", videoPublishedAt: "2026-09-10T00:00:00Z" },
        },
      ],
      _playlist: url.searchParams.get("playlistId"),
    }),
  });

  const videos = await fetchUploads({ channelId: "UCabc", title: "Chan", thumbnail: "" }, 10, "tok");

  assert.equal(calls[0].url.searchParams.get("playlistId"), "UUabc", "UC prefix becomes UU");
  assert.equal(videos.length, 1);
  assert.equal(videos[0].id, "v1");
  assert.equal(videos[0].publishedAt, "2026-09-10T00:00:00Z", "uses videoPublishedAt, not playlist add time");
});

test("hydrateVideos batches ids 50 at a time and fills in detail", async () => {
  const base = Array.from({ length: 120 }, (_, i) => ({
    id: `v${i}`, title: `t${i}`, description: "", channelId: "UCa",
    channelTitle: "A", publishedAt: "2026-09-01T00:00:00Z", thumbnail: "",
  }));

  mockApi({
    videos: (url) => ({
      items: url.searchParams.get("id")!.split(",").map((id) => ({
        id,
        snippet: { tags: ["x"], description: "desc" },
        contentDetails: { duration: id === "v0" ? "PT30S" : "PT10M" },
        statistics: { viewCount: "1000", likeCount: "10" },
        status: { embeddable: id !== "v1" },
      })),
    }),
  });

  const meter = new QuotaMeter();
  const out = await hydrateVideos(base, "tok", meter);

  assert.equal(meter.used, 3, "120 ids => 3 requests");
  assert.equal(out[0].isShort, true, "30s upload is flagged as a Short");
  assert.equal(out[2].isShort, false, "10m upload is not");
  assert.equal(out[1].embeddable, false, "embeddable flag is carried through");
  assert.equal(out[0].viewCount, 1000);
  assert.equal(out[0].durationSeconds, 30);
  assert.deepEqual(out[0].tags, ["x"]);
  for (const call of calls) {
    assert.ok(call.url.searchParams.get("id")!.split(",").length <= 50);
  }
});

test("an API key is used for public reads instead of the OAuth token", async () => {
  process.env.YOUTUBE_API_KEY = "KEY123";
  mockApi({ playlistItems: () => ({ items: [] }) });

  await fetchUploads({ channelId: "UCabc", title: "C", thumbnail: "" }, 5, "tok");

  assert.equal(calls[0].url.searchParams.get("key"), "KEY123");
  assert.equal(calls[0].headers.Authorization, undefined, "no bearer token leaked alongside the key");
});

test("a 401 becomes YouTubeAuthError", async () => {
  mockApi({ subscriptions: () => ({ error: "bad token" }) }, 401);
  await assert.rejects(() => fetchSubscriptions("tok"), YouTubeAuthError);
});

test("a quota 403 becomes YouTubeQuotaError", async () => {
  mockApi({ subscriptions: () => ({ error: { errors: [{ reason: "quotaExceeded" }] } }) }, 403);
  await assert.rejects(() => fetchSubscriptions("tok"), YouTubeQuotaError);
});
