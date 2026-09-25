import { XMLParser } from "fast-xml-parser";

/**
 * YouTube publishes every channel's recent uploads as an Atom feed at
 * https://www.youtube.com/feeds/videos.xml?channel_id=UC...
 *
 * It costs zero API quota and carries video id, title, publish time,
 * thumbnail, description and view count — everything the feed list needs
 * except duration, likes, tags and embeddability. Those come from a single
 * batched videos.list call, and only for IDs we have never seen before.
 *
 * The feed holds roughly the 15 most recent uploads, which is why the API
 * path is kept as a fallback for backfilling further than that.
 */
export const RSS_BASE = "https://www.youtube.com/feeds/videos.xml";

export function channelFeedUrl(channelId: string): string {
  return `${RSS_BASE}?channel_id=${encodeURIComponent(channelId)}`;
}

export type RssEntry = {
  videoId: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnail: string;
  /** Present in media:community, absent on very new uploads. */
  viewCount?: number;
};

export type RssFeed = {
  channelId: string;
  channelTitle: string;
  entries: RssEntry[];
};

export class RssError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Collapses yt:videoId -> videoId and media:group -> group, which keeps the
  // access paths below readable.
  removeNSPrefix: true,
  // Titles are frequently numeric-looking ("2025", "10"); without this the
  // parser would hand back numbers and break string handling downstream.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Named entities (&amp;) decode by default, but numeric ones (&#39;) need
  // this — and YouTube escapes every apostrophe in a title that way.
  htmlEntities: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  // fast-xml-parser wraps mixed content in { "#text": "..." }.
  if (value && typeof value === "object" && "#text" in (value as any)) {
    return String((value as any)["#text"] ?? "");
  }
  return "";
}

/**
 * YouTube's feed-level <yt:channelId> and <id> drop the leading "UC" — the
 * feed for UCYO_jab_esuFRV4b17AJtAw reports "YO_jab_esuFRV4b17AJtAw", while
 * the per-entry <yt:channelId> carries the full, correct id. Trusting the
 * feed-level value would write malformed channel ids into the database, so it
 * is only ever a last resort. `expectedChannelId` (what the caller asked for)
 * wins, then the entry-level id, then the alternate link.
 */
function resolveChannelId(feed: any, expected?: string): string {
  if (expected) return expected;

  for (const entry of asArray<any>(feed.entry)) {
    const fromEntry = text(entry.channelId);
    if (fromEntry.startsWith("UC")) return fromEntry;
  }

  for (const link of asArray<any>(feed.link)) {
    const href = String(link?.["@_href"] ?? "");
    const match = /\/channel\/(UC[\w-]+)/.exec(href);
    if (match) return match[1];
  }

  const raw = text(feed.channelId);
  return raw.startsWith("UC") ? raw : `UC${raw}`;
}

/** Parses a YouTube channel Atom feed. Pure — no network, fully testable. */
export function parseChannelFeed(xml: string, expectedChannelId?: string): RssFeed {
  if (!xml || !xml.includes("<feed")) {
    throw new RssError("Response is not a YouTube Atom feed");
  }

  let doc: any;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new RssError(`Malformed XML: ${(err as Error).message}`);
  }

  const feed = doc?.feed;
  if (!feed) throw new RssError("Atom feed has no <feed> element");

  const channelId = resolveChannelId(feed, expectedChannelId);
  const channelTitle = text(feed.title) || text(feed.author?.name);

  const entries: RssEntry[] = [];
  for (const entry of asArray<any>(feed.entry)) {
    const videoId = text(entry.videoId);
    if (!videoId) continue;

    const group = entry.group ?? {};
    const thumbnails = asArray<any>(group.thumbnail);
    const rawViews = group.community?.statistics?.["@_views"];
    const views = rawViews === undefined ? undefined : Number(rawViews);

    entries.push({
      videoId,
      // Entry-level ids are the trustworthy ones; see resolveChannelId.
      channelId: text(entry.channelId).startsWith("UC")
        ? text(entry.channelId)
        : channelId,
      channelTitle: text(entry.author?.name) || channelTitle,
      // media:title survives some odd escaping that the plain <title> does not.
      title: text(entry.title) || text(group.title),
      description: text(group.description),
      publishedAt: text(entry.published) || text(entry.updated),
      thumbnail: thumbnails[0]?.["@_url"] ?? "",
      viewCount: Number.isFinite(views) ? views : undefined,
    });
  }

  // Newest first, matching the rest of the app. YouTube usually sorts this way
  // already, but a channel that edits an old upload can shuffle the order.
  entries.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return { channelId, channelTitle, entries };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetches and parses one channel's feed. Costs no API quota. */
export async function fetchChannelFeed(
  channelId: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 10_000,
): Promise<RssFeed> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(channelFeedUrl(channelId), {
      signal: controller.signal,
      headers: { "User-Agent": "quiet-youtube-reader/1.0 (+personal use)" },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new RssError(`RSS for ${channelId} returned ${res.status}`);
    }
    return parseChannelFeed(await res.text(), channelId);
  } catch (err) {
    if (err instanceof RssError) throw err;
    throw new RssError(`RSS for ${channelId} failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
