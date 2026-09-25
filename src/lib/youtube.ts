import type { ChannelDetail, Subscription, Video } from "./types";

const API = "https://www.googleapis.com/youtube/v3";

/** Thrown when the OAuth token is dead — the UI turns this into "sign in again". */
export class YouTubeAuthError extends Error {}
/** Thrown when the project has burned through its 10,000 daily units. */
export class YouTubeQuotaError extends Error {}

/**
 * Every call is metered so the app can show what a refresh actually cost.
 * list endpoints are 1 unit per request regardless of how many items come back,
 * which is why everything below batches as hard as it can.
 */
export class QuotaMeter {
  used = 0;
  spend(units = 1) {
    this.used += units;
  }
}

type Params = Record<string, string | number | undefined>;

async function yt<T>(
  path: string,
  params: Params,
  token: string,
  meter?: QuotaMeter,
): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }

  // A plain API key works for public reads and keeps them off the OAuth token.
  // Quota is billed to the same Cloud project either way.
  const key = process.env.YOUTUBE_API_KEY;
  const isPublic = path !== "subscriptions";
  const headers: Record<string, string> = {};
  if (isPublic && key) url.searchParams.set("key", key);
  else headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  meter?.spend(1);

  if (!res.ok) {
    const body = await res.text();
    if (res.status === 401) {
      throw new YouTubeAuthError(`YouTube rejected the access token: ${body}`);
    }
    if (res.status === 403 && /quota/i.test(body)) {
      throw new YouTubeQuotaError("Daily YouTube API quota exhausted.");
    }
    throw new Error(`YouTube ${path} failed (${res.status}): ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Walks `nextPageToken` until the API runs out of pages or we hit `maxPages`. */
async function paginate<Item>(
  path: string,
  params: Params,
  token: string,
  meter: QuotaMeter | undefined,
  maxPages = 20,
): Promise<Item[]> {
  const items: Item[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const data = await yt<{ items?: Item[]; nextPageToken?: string }>(
      path,
      { ...params, pageToken },
      token,
      meter,
    );
    items.push(...(data.items ?? []));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

/** Runs `fn` over `items` with a ceiling on in-flight requests. */
async function mapLimit<In, Out>(
  items: In[],
  limit: number,
  fn: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const out = new Array<Out>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function bestThumb(thumbs: Record<string, { url: string }> | undefined): string {
  if (!thumbs) return "";
  return (
    thumbs.maxres?.url ??
    thumbs.standard?.url ??
    thumbs.high?.url ??
    thumbs.medium?.url ??
    thumbs.default?.url ??
    ""
  );
}

/** "PT1H2M3S" -> 3723 */
export function parseDuration(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return undefined;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 +
    Number(h ?? 0) * 3600 +
    Number(min ?? 0) * 60 +
    Number(s ?? 0)
  );
}

/**
 * Every channel's uploads live in a playlist whose id is the channel id with
 * the "UC" prefix swapped for "UU". Deriving it saves one channels.list call
 * per channel on every single refresh.
 */
export function uploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}

/** Cost: 1 unit per 50 subscriptions. */
export async function fetchSubscriptions(
  token: string,
  meter?: QuotaMeter,
): Promise<Subscription[]> {
  type Item = {
    snippet: {
      title: string;
      resourceId: { channelId: string };
      thumbnails?: Record<string, { url: string }>;
    };
  };
  const items = await paginate<Item>(
    "subscriptions",
    { part: "snippet", mine: "true", maxResults: 50, order: "alphabetical" },
    token,
    meter,
    40,
  );
  const seen = new Set<string>();
  const subs: Subscription[] = [];
  for (const item of items) {
    const channelId = item.snippet.resourceId.channelId;
    if (!channelId || seen.has(channelId)) continue;
    seen.add(channelId);
    subs.push({
      channelId,
      title: item.snippet.title,
      thumbnail: bestThumb(item.snippet.thumbnails),
    });
  }
  return subs.sort((a, b) => a.title.localeCompare(b.title));
}

type PlaylistItem = {
  snippet: {
    title: string;
    description: string;
    channelId: string;
    videoOwnerChannelId?: string;
    videoOwnerChannelTitle?: string;
    channelTitle: string;
    thumbnails?: Record<string, { url: string }>;
    resourceId: { videoId: string };
  };
  contentDetails: { videoId: string; videoPublishedAt?: string };
};

function toVideo(item: PlaylistItem, fallbackChannel?: Subscription): Video {
  const s = item.snippet;
  return {
    id: item.contentDetails.videoId ?? s.resourceId.videoId,
    title: s.title,
    description: s.description ?? "",
    channelId: s.videoOwnerChannelId ?? fallbackChannel?.channelId ?? s.channelId,
    channelTitle:
      s.videoOwnerChannelTitle ?? fallbackChannel?.title ?? s.channelTitle,
    publishedAt: item.contentDetails.videoPublishedAt ?? new Date(0).toISOString(),
    thumbnail: bestThumb(s.thumbnails),
  };
}

/** Cost: 1 unit per 50 videos requested. */
export async function fetchUploads(
  channel: Subscription,
  limit: number,
  token: string,
  meter?: QuotaMeter,
): Promise<Video[]> {
  const items = await paginate<PlaylistItem>(
    "playlistItems",
    {
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId(channel.channelId),
      maxResults: Math.min(50, limit),
    },
    token,
    meter,
    Math.ceil(limit / 50),
  );
  return items
    .slice(0, limit)
    .map((item) => toVideo(item, channel))
    .filter((v) => Boolean(v.id));
}

/**
 * Fills in duration, view/like counts, tags and embeddability.
 * Cost: 1 unit per 50 videos — cheap enough to run over the whole feed.
 */
export async function hydrateVideos(
  videos: Video[],
  token: string,
  meter?: QuotaMeter,
): Promise<Video[]> {
  type Detail = {
    id: string;
    snippet?: { tags?: string[]; description?: string };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string };
    status?: { embeddable?: boolean };
  };

  const ids = [...new Set(videos.map((v) => v.id))];
  const batches = chunk(ids, 50);
  const results = await mapLimit(batches, 5, (batch) =>
    yt<{ items?: Detail[] }>(
      "videos",
      {
        part: "contentDetails,statistics,status,snippet",
        id: batch.join(","),
        maxResults: 50,
      },
      token,
      meter,
    ),
  );

  const byId = new Map<string, Detail>();
  for (const r of results) for (const d of r.items ?? []) byId.set(d.id, d);

  return videos.map((v) => {
    const d = byId.get(v.id);
    if (!d) return v;
    const seconds = parseDuration(d.contentDetails?.duration);
    return {
      ...v,
      duration: d.contentDetails?.duration,
      durationSeconds: seconds,
      // The API exposes no Shorts flag. Sub-minute uploads are the reliable
      // signal; this only drives a badge, nothing is ever filtered out.
      isShort: seconds !== undefined && seconds > 0 && seconds <= 60,
      viewCount: d.statistics?.viewCount ? Number(d.statistics.viewCount) : undefined,
      likeCount: d.statistics?.likeCount ? Number(d.statistics.likeCount) : undefined,
      tags: d.snippet?.tags,
      description: d.snippet?.description ?? v.description,
      embeddable: d.status?.embeddable ?? true,
    };
  });
}

/** Cost: 1 unit. */
export async function fetchChannel(
  channelId: string,
  token: string,
  meter?: QuotaMeter,
): Promise<ChannelDetail | null> {
  type Item = {
    id: string;
    snippet: { title: string; description: string; thumbnails?: Record<string, { url: string }> };
    brandingSettings?: { image?: { bannerExternalUrl?: string } };
    statistics?: { subscriberCount?: string; videoCount?: string };
  };
  const data = await yt<{ items?: Item[] }>(
    "channels",
    { part: "snippet,statistics,brandingSettings", id: channelId },
    token,
    meter,
  );
  const item = data.items?.[0];
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnail: bestThumb(item.snippet.thumbnails),
    banner: item.brandingSettings?.image?.bannerExternalUrl,
    subscriberCount: item.statistics?.subscriberCount
      ? Number(item.statistics.subscriberCount)
      : undefined,
    videoCount: item.statistics?.videoCount ? Number(item.statistics.videoCount) : undefined,
  };
}

export { mapLimit, chunk };

/**
 * Full detail for one video, used when the watch page is opened for something
 * that isn't in the cached feed (an old upload reached from a channel page).
 * Cost: 1 unit.
 */
export async function fetchVideoById(
  id: string,
  token: string,
  meter?: QuotaMeter,
): Promise<Video | null> {
  type Item = {
    id: string;
    snippet: {
      title: string;
      description: string;
      channelId: string;
      channelTitle: string;
      publishedAt: string;
      tags?: string[];
      thumbnails?: Record<string, { url: string }>;
    };
    contentDetails?: { duration?: string };
    statistics?: { viewCount?: string; likeCount?: string };
    status?: { embeddable?: boolean };
  };

  const data = await yt<{ items?: Item[] }>(
    "videos",
    { part: "snippet,contentDetails,statistics,status", id },
    token,
    meter,
  );
  const item = data.items?.[0];
  if (!item) return null;

  const seconds = parseDuration(item.contentDetails?.duration);
  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description ?? "",
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    thumbnail: bestThumb(item.snippet.thumbnails),
    duration: item.contentDetails?.duration,
    durationSeconds: seconds,
    isShort: seconds !== undefined && seconds > 0 && seconds <= 60,
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
    likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : undefined,
    tags: item.snippet.tags,
    embeddable: item.status?.embeddable ?? true,
  };
}
