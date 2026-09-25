import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  RssError,
  channelFeedUrl,
  fetchChannelFeed,
  parseChannelFeed,
} from "../src/lib/rss.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REAL_FEED = readFileSync(join(here, "fixtures/3blue1brown.xml"), "utf8");

test("channelFeedUrl builds the zero-quota endpoint", () => {
  assert.equal(
    channelFeedUrl("UCabc"),
    "https://www.youtube.com/feeds/videos.xml?channel_id=UCabc",
  );
});

test("parses a real YouTube feed", () => {
  const feed = parseChannelFeed(REAL_FEED);
  assert.equal(feed.channelTitle, "3Blue1Brown");
  assert.equal(feed.entries.length, 2);

  const entry = feed.entries[0];
  assert.match(entry.videoId, /^[\w-]{11}$/);
  assert.ok(entry.title.length > 0);
  assert.ok(entry.thumbnail.startsWith("https://"));
  assert.ok(!Number.isNaN(Date.parse(entry.publishedAt)));
});

test("recovers the UC prefix that YouTube drops from the feed-level id", () => {
  // The fixture really does contain <yt:channelId>YO_jab_...</yt:channelId> at
  // feed level. Trusting it would write a malformed id into the database.
  assert.match(REAL_FEED, /<yt:channelId>YO_jab_esuFRV4b17AJtAw<\/yt:channelId>/);

  const feed = parseChannelFeed(REAL_FEED);
  assert.equal(feed.channelId, "UCYO_jab_esuFRV4b17AJtAw");
  for (const entry of feed.entries) {
    assert.equal(entry.channelId, "UCYO_jab_esuFRV4b17AJtAw");
  }
});

test("an explicitly supplied channel id always wins", () => {
  const feed = parseChannelFeed(REAL_FEED, "UCoverride123");
  assert.equal(feed.channelId, "UCoverride123");
});

const synthetic = (entries: string, feedChannel = "UCfeed") => `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"
      xmlns:media="http://search.yahoo.com/mrss/"
      xmlns="http://www.w3.org/2005/Atom">
  <link rel="alternate" href="https://www.youtube.com/channel/${feedChannel}"/>
  <yt:channelId>${feedChannel}</yt:channelId>
  <title>Test Channel</title>
  <author><name>Test Channel</name></author>
  ${entries}
</feed>`;

const entry = (id: string, title: string, published: string, extra = "") => `
  <entry>
    <yt:videoId>${id}</yt:videoId>
    <yt:channelId>UCfeed</yt:channelId>
    <title>${title}</title>
    <author><name>Test Channel</name></author>
    <published>${published}</published>
    <media:group>
      <media:description>desc for ${id}</media:description>
      <media:thumbnail url="https://i.ytimg.com/vi/${id}/hqdefault.jpg"/>
      ${extra}
    </media:group>
  </entry>`;

test("a single-entry feed is not mistaken for a scalar", () => {
  // fast-xml-parser collapses a lone repeated element into an object.
  const feed = parseChannelFeed(synthetic(entry("aaaaaaaaaaa", "Only one", "2026-09-01T00:00:00+00:00")));
  assert.equal(feed.entries.length, 1);
  assert.equal(feed.entries[0].videoId, "aaaaaaaaaaa");
});

test("a channel with no uploads yields an empty list, not an error", () => {
  const feed = parseChannelFeed(synthetic(""));
  assert.deepEqual(feed.entries, []);
  assert.equal(feed.channelId, "UCfeed");
});

test("entries come back newest first", () => {
  const feed = parseChannelFeed(
    synthetic(
      entry("old00000000", "Old", "2026-01-01T00:00:00+00:00") +
        entry("new00000000", "New", "2026-09-01T00:00:00+00:00") +
        entry("mid00000000", "Mid", "2026-05-01T00:00:00+00:00"),
    ),
  );
  assert.deepEqual(feed.entries.map((e) => e.videoId), [
    "new00000000",
    "mid00000000",
    "old00000000",
  ]);
});

test("XML entities in titles are decoded", () => {
  const feed = parseChannelFeed(
    synthetic(entry("ent00000000", "Rust &amp; C++ &lt;tips&gt; &#39;live&#39;", "2026-09-01T00:00:00+00:00")),
  );
  assert.equal(feed.entries[0].title, "Rust & C++ <tips> 'live'");
});

test("a numeric-looking title stays a string", () => {
  const feed = parseChannelFeed(
    synthetic(entry("num00000000", "2025", "2026-09-01T00:00:00+00:00")),
  );
  assert.equal(feed.entries[0].title, "2025");
  assert.equal(typeof feed.entries[0].title, "string");
});

test("view count is read when present and left undefined when not", () => {
  const withViews = parseChannelFeed(
    synthetic(
      entry("vc000000000", "Has views", "2026-09-01T00:00:00+00:00",
        `<media:community><media:statistics views="12345"/></media:community>`),
    ),
  );
  assert.equal(withViews.entries[0].viewCount, 12345);

  const without = parseChannelFeed(
    synthetic(entry("nv000000000", "No views", "2026-09-01T00:00:00+00:00")),
  );
  assert.equal(without.entries[0].viewCount, undefined);
});

test("entries missing a video id are skipped rather than poisoning the feed", () => {
  const broken = synthetic(`
    <entry><title>No id here</title><published>2026-09-01T00:00:00+00:00</published></entry>
    ${entry("good0000000", "Good", "2026-09-02T00:00:00+00:00")}`);
  const feed = parseChannelFeed(broken);
  assert.deepEqual(feed.entries.map((e) => e.videoId), ["good0000000"]);
});

test("non-feed input is rejected", () => {
  assert.throws(() => parseChannelFeed("<html><body>404</body></html>"), RssError);
  assert.throws(() => parseChannelFeed(""), RssError);
});

test("fetchChannelFeed surfaces a non-200 as RssError", async () => {
  const fake = async () => new Response("nope", { status: 404 });
  await assert.rejects(() => fetchChannelFeed("UCmissing", fake), RssError);
});

test("fetchChannelFeed passes the requested id through as authoritative", async () => {
  const fake = async () => new Response(REAL_FEED, { status: 200 });
  const feed = await fetchChannelFeed("UCrequested", fake);
  assert.equal(feed.channelId, "UCrequested");
});
