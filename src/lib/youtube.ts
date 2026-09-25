import type { ChannelDetail, Subscription, Video } from "./types";
import type { QuotaEndpoint, QuotaLedger } from "./quota";

const API = "https://www.googleapis.com/youtube/v3";

/** Thrown when the OAuth token is dead — the UI turns this into "sign in again". */
export class YouTubeAuthError extends Error {}
/** Thrown when the Google project has burned through its 10,000 daily units. */
export class YouTubeQuotaError extends Error {}

type Params = Record<string, string | number | boolean | undefined>;

// --- pure helpers, shared with the cache layer ------------------------------

export function bestThumb(thumbs: Record<string, { url: string }> | undefined): string {
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
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
  );
}

/**
 * Every channel's uploads live in a playlist whose id is the channel id with
 * the "UC" prefix swapped for "UU". Only needed on the API fallback path now
 * that RSS covers the common case.
 */
export function uploadsPlaylistId(channelId: string): string {
  return `UU${channelId.slice(2)}`;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items` with a ceiling on in-flight requests. */
export async function mapLimit<In, Out>(
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

type VideoDetail = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    publishedAt?: string;
    tags?: string[];
    categoryId?: string;
    thumbnails?: Record<string, { url: string }>;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
  status?: { embeddable?: boolean };
  topicDetails?: { topicCategories?: string[] };
};

export function detailToVideo(item: VideoDetail): Video {
  const seconds = parseDuration(item.contentDetails?.duration);
  return {
    id: item.id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    channelId: item.snippet?.channelId ?? "",
    channelTitle: item.snippet?.channelTitle ?? "",
    publishedAt: item.snippet?.publishedAt ?? new Date(0).toISOString(),
    thumbnail: bestThumb(item.snippet?.thumbnails),
    duration: item.contentDetails?.duration,
    durationSeconds: seconds,
    // The API exposes no Shorts flag; sub-minute uploads are the only signal.
    // Nothing is ever filtered on it — it only drives a badge.
    isShort: seconds !== undefined && seconds > 0 && seconds <= 60,
    viewCount: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
    likeCount: item.statistics?.likeCount ? Number(item.statistics.likeCount) : undefined,
    tags: item.snippet?.tags ?? [],
    embeddable: item.status?.embeddable ?? true,
  };
}

export type YouTubeClient = ReturnType<typeof createYouTubeClient>;

export type ClientOptions = {
  token: string;
  ledger: QuotaLedger;
  apiKey?: string;
  fetchImpl?: typeof fetch;
};

/**
 * The only path from this app to googleapis.com.
 *
 * Every method funnels through `request`, which funnels through
 * `ledger.spend` — so the quota_log table is a complete record of API usage,
 * not an estimate, and the daily budget is enforced at the one place it can
 * actually be enforced.
 */
export function createYouTubeClient({ token, ledger, apiKey, fetchImpl }: ClientOptions) {
  const doFetch = fetchImpl ?? fetch;
  const key = apiKey ?? process.env.YOUTUBE_API_KEY;

  async function request<T>(
    endpoint: QuotaEndpoint,
    path: string,
    params: Params,
    opts: { interactive?: boolean } = {},
  ): Promise<T> {
    return ledger.spend(
      endpoint,
      async () => {
        const url = new URL(`${API}/${path}`);
        for (const [k, v] of Object.entries(params)) {
          if (v !== undefined) url.searchParams.set(k, String(v));
        }

        // A plain API key covers public reads; only `subscriptions` needs the
        // user's OAuth token. Quota is billed to the same project either way.
        const isPublic = path !== "subscriptions";
        const headers: Record<string, string> = {};
        if (isPublic && key) url.searchParams.set("key", key);
        else headers.Authorization = `Bearer ${token}`;

        const res = await doFetch(url, { headers, cache: "no-store" });
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
      },
      { interactive: opts.interactive },
    );
  }

  async function paginate<Item>(
    endpoint: QuotaEndpoint,
    path: string,
    params: Params,
    maxPages: number,
  ): Promise<Item[]> {
    const items: Item[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const data = await request<{ items?: Item[]; nextPageToken?: string }>(
        endpoint,
        path,
        { ...params, pageToken },
      );
      items.push(...(data.items ?? []));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return items;
  }

  return {
    /** Cost: 1 unit per 50 subscriptions. */
    async listSubscriptions(): Promise<Subscription[]> {
      type Item = {
        snippet: {
          title: string;
          resourceId: { channelId: string };
          thumbnails?: Record<string, { url: string }>;
        };
      };
      const items = await paginate<Item>(
        "subscriptions.list",
        "subscriptions",
        { part: "snippet", mine: "true", maxResults: 50, order: "alphabetical" },
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
    },

    /**
     * Cost: 1 unit per 50 ids. This is the workhorse — never call it for a
     * single video when several are pending.
     */
    async listVideos(ids: string[]): Promise<Video[]> {
      const unique = [...new Set(ids)].filter(Boolean);
      if (unique.length === 0) return [];

      const batches = chunk(unique, 50);
      const pages = await mapLimit(batches, 4, (batch) =>
        request<{ items?: VideoDetail[] }>("videos.list", "videos", {
          part: "contentDetails,statistics,status,snippet,topicDetails",
          id: batch.join(","),
          maxResults: 50,
        }),
      );
      return pages.flatMap((p) => (p.items ?? []).map(detailToVideo));
    },

    /** Cost: 1 unit. */
    async getChannel(channelId: string): Promise<ChannelDetail | null> {
      const data = await request<{ items?: any[] }>("channels.list", "channels", {
        part: "snippet,statistics,brandingSettings,topicDetails",
        id: channelId,
      });
      return toChannelDetail(data.items?.[0]);
    },

    /**
     * Resolves an @handle to a channel. Cost: 1 unit — and the caller caches
     * the answer permanently, including misses, so no handle is ever resolved
     * twice.
     */
    async getChannelByHandle(handle: string): Promise<ChannelDetail | null> {
      const data = await request<{ items?: any[] }>("channels.list", "channels", {
        part: "snippet,statistics,brandingSettings,topicDetails",
        forHandle: handle.startsWith("@") ? handle : `@${handle}`,
      });
      return toChannelDetail(data.items?.[0]);
    },

    /** Cost: 1 unit per 50 playlists. */
    async listChannelPlaylists(channelId: string, max = 50) {
      type Item = {
        id: string;
        snippet: {
          title: string;
          description: string;
          channelId: string;
          channelTitle: string;
          thumbnails?: Record<string, { url: string }>;
        };
        contentDetails?: { itemCount?: number };
      };
      const items = await paginate<Item>(
        "playlists.list",
        "playlists",
        { part: "snippet,contentDetails", channelId, maxResults: 50 },
        Math.ceil(max / 50),
      );
      return items.slice(0, max).map((p) => ({
        playlistId: p.id,
        title: p.snippet.title,
        description: p.snippet.description ?? "",
        channelId: p.snippet.channelId,
        channelTitle: p.snippet.channelTitle,
        thumbnail: bestThumb(p.snippet.thumbnails),
        itemCount: p.contentDetails?.itemCount ?? 0,
      }));
    },

    /** Cost: 1 unit per 50 items. */
    async listPlaylistItems(playlistId: string, max = 200) {
      type Item = {
        snippet: { title: string; position: number };
        contentDetails: { videoId: string };
      };
      const items = await paginate<Item>(
        "playlistItems.list",
        "playlistItems",
        { part: "snippet,contentDetails", playlistId, maxResults: 50 },
        Math.ceil(max / 50),
      );
      return items.slice(0, max).map((i) => ({
        videoId: i.contentDetails.videoId,
        title: i.snippet.title,
        position: i.snippet.position ?? 0,
      }));
    },

    /**
     * API fallback for a channel whose RSS feed failed, and the only way to
     * reach further back than the ~15 uploads RSS carries.
     * Cost: 1 unit per 50 videos.
     */
    async listUploads(channelId: string, max = 50) {
      type Item = {
        snippet: {
          title: string;
          description: string;
          videoOwnerChannelId?: string;
          videoOwnerChannelTitle?: string;
          channelId: string;
          channelTitle: string;
          thumbnails?: Record<string, { url: string }>;
        };
        contentDetails: { videoId: string; videoPublishedAt?: string };
      };
      const items = await paginate<Item>(
        "playlistItems.list",
        "playlistItems",
        {
          part: "snippet,contentDetails",
          playlistId: uploadsPlaylistId(channelId),
          maxResults: 50,
        },
        Math.ceil(max / 50),
      );
      return items.slice(0, max).map((i) => ({
        videoId: i.contentDetails.videoId,
        channelId: i.snippet.videoOwnerChannelId ?? channelId,
        channelTitle: i.snippet.videoOwnerChannelTitle ?? i.snippet.channelTitle,
        title: i.snippet.title,
        description: i.snippet.description ?? "",
        publishedAt: i.contentDetails.videoPublishedAt ?? new Date(0).toISOString(),
        thumbnail: bestThumb(i.snippet.thumbnails),
      }));
    },

    /**
     * 100 units a call — by far the most expensive thing here. Never invoked
     * automatically; only from an explicit "Search all of YouTube" click,
     * which is why it is flagged interactive and allowed to use the reserve.
     */
    async searchVideos(query: string, max = 25) {
      const data = await request<{ items?: any[] }>(
        "search.list",
        "search",
        { part: "snippet", q: query, type: "video", maxResults: Math.min(50, max) },
        { interactive: true },
      );
      return (data.items ?? []).map((item) => ({
        videoId: item.id?.videoId as string,
        title: item.snippet?.title ?? "",
        description: item.snippet?.description ?? "",
        channelId: item.snippet?.channelId ?? "",
        channelTitle: item.snippet?.channelTitle ?? "",
        publishedAt: item.snippet?.publishedAt ?? "",
        thumbnail: bestThumb(item.snippet?.thumbnails),
      })).filter((v) => Boolean(v.videoId));
    },
  };
}

function toChannelDetail(item: any): ChannelDetail | null {
  if (!item) return null;
  return {
    channelId: item.id,
    title: item.snippet?.title ?? "",
    description: item.snippet?.description ?? "",
    thumbnail: bestThumb(item.snippet?.thumbnails),
    handle: item.snippet?.customUrl?.replace(/^@/, "") ?? undefined,
    banner: item.brandingSettings?.image?.bannerExternalUrl,
    subscriberCount: item.statistics?.subscriberCount
      ? Number(item.statistics.subscriberCount)
      : undefined,
    videoCount: item.statistics?.videoCount ? Number(item.statistics.videoCount) : undefined,
    topicCategories: item.topicDetails?.topicCategories ?? [],
  };
}
