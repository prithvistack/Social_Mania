import { QuotaBudgetError } from "./quota";
import {
  buildReason,
  extractMentions,
  scoreMentions,
  type MentionSource,
  type ScoredCandidate,
} from "./mentions";
import { deriveCategory } from "./topics";
import type { AppContext } from "./context";
import { DISCOVER_INTERVAL_MS, DISCOVER_STATE_KEY } from "./db/discover";

/** Only mine recent uploads — a 2019 collab is not a live recommendation. */
export const LOOKBACK_DAYS = 180;
/** Ceiling on handles resolved per run, so one run cannot eat the budget. */
export const MAX_RESOLUTIONS_PER_RUN = 40;
/** Below this, the evidence is too thin to show. */
export const MIN_SCORE = 0.5;

export type DiscoveryResult = {
  scanned: number;
  candidates: number;
  resolved: number;
  skippedAlreadyKnown: number;
  suggestions: number;
  quotaUsed: number;
  ranAt: string;
  degraded: boolean;
};

/**
 * Finds channels worth following from collaborations and mentions inside the
 * videos already cached. The expensive part — turning an @handle into a
 * channel — happens at most once per handle for the lifetime of the database,
 * because both hits and misses are recorded permanently.
 */
export async function runDiscovery(
  ctx: AppContext,
  opts: { force?: boolean } = {},
): Promise<DiscoveryResult | null> {
  const stale = await ctx.state.isStale(DISCOVER_STATE_KEY, DISCOVER_INTERVAL_MS);
  if (!stale && !opts.force) return null;

  const before = (await ctx.ledger.status()).used;
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // --- gather the corpus (all cached, zero quota) --------------------------
  const feed = await ctx.videos.feed(1500);
  const recent = feed.filter((v) => v.publishedAt >= since);
  const history = await ctx.history.since(since);
  const watchedIds = new Set(history.map((h) => h.video_id));

  const sources: MentionSource[] = recent.map((v) => ({
    videoId: v.id,
    title: v.title,
    description: v.description,
    channelId: v.channelId,
    channelTitle: v.channelTitle,
    publishedAt: v.publishedAt,
    watched: watchedIds.has(v.id),
  }));

  const mentions = sources.flatMap(extractMentions);
  const scored = scoreMentions(mentions);

  // --- exclude what we already know ---------------------------------------
  const subscribed = new Set(
    (await ctx.videos.subscribedChannels()).map((c) => c.channel_id),
  );
  const dismissed = await ctx.discover.dismissedIds();
  const subscribedTitles = new Set(
    (await ctx.videos.subscribedChannels()).map((c) => c.title.toLowerCase()),
  );

  const handleCandidates = scored.filter((c) => c.kind === "handle");
  const channelCandidates = scored.filter(
    (c) => c.kind === "channel" && !subscribed.has(c.key) && !dismissed.has(c.key),
  );
  // A guessed guest name is only useful if it also shows up as a handle, so it
  // never triggers a paid lookup on its own.
  const guestNames = new Map(
    scored.filter((c) => c.kind === "guest").map((c) => [c.key.toLowerCase(), c]),
  );

  const known = await ctx.discover.knownHandles(handleCandidates.map((c) => c.key));
  let skippedAlreadyKnown = 0;
  let resolved = 0;
  let degraded = false;

  const resolvedChannels = new Map<string, ScoredCandidate>();

  for (const candidate of handleCandidates) {
    if (known.has(candidate.key)) {
      skippedAlreadyKnown++;
      const channelId = known.get(candidate.key);
      // A handle that resolved to nothing stays resolved to nothing, forever.
      if (channelId && !subscribed.has(channelId) && !dismissed.has(channelId)) {
        resolvedChannels.set(channelId, candidate);
      }
      continue;
    }
    if (resolved >= MAX_RESOLUTIONS_PER_RUN) continue;
    if (candidate.score < MIN_SCORE) continue;

    try {
      const channel = await ctx.client.getChannelByHandle(candidate.key);
      resolved++;
      await ctx.discover.recordResolution(candidate.key, channel?.channelId ?? null);
      if (channel && !subscribed.has(channel.channelId) && !dismissed.has(channel.channelId)) {
        resolvedChannels.set(channel.channelId, candidate);
        await ctx.videos.upsertChannels([
          {
            channel_id: channel.channelId,
            title: channel.title,
            handle: channel.handle ?? candidate.key,
            description: channel.description,
            thumbnail: channel.thumbnail,
            subscriber_count: channel.subscriberCount ?? null,
            video_count: channel.videoCount ?? null,
            topic_categories: channel.topicCategories ?? [],
          },
        ]);
      }
    } catch (err) {
      if (err instanceof QuotaBudgetError) {
        degraded = true;
        break;
      }
      // A handle that errors is left unrecorded so it can be retried tomorrow.
    }
  }

  // Channels linked by explicit /channel/UC... URLs need no resolution at all.
  for (const candidate of channelCandidates) {
    if (!resolvedChannels.has(candidate.key)) {
      resolvedChannels.set(candidate.key, candidate);
    }
  }

  // --- build the suggestion rows ------------------------------------------
  const rows = [];
  for (const [channelId, candidate] of resolvedChannels) {
    if (candidate.score < MIN_SCORE) continue;
    const channel = await ctx.videos.getChannel(channelId);
    const title = channel?.title ?? candidate.key;
    if (subscribedTitles.has(title.toLowerCase())) continue;

    // Fold in a matching guest-name mention, if the same person was named.
    const guest = guestNames.get(title.toLowerCase());
    const score = candidate.score + (guest?.score ?? 0);

    rows.push({
      channel_id: channelId,
      handle: channel?.handle ?? (candidate.kind === "handle" ? candidate.key : null),
      title,
      thumbnail: channel?.thumbnail ?? "",
      description: channel?.description ?? "",
      category: deriveCategory({
        topicCategories: channel?.topic_categories,
        title,
        description: channel?.description,
      }),
      score,
      evidence: candidate.sources.slice(0, 6).map((s) => ({
        video_id: s.videoId,
        video_title: s.title,
        channel_title: s.channelTitle,
        watched: s.watched,
        published_at: s.publishedAt,
      })),
      reason: buildReason(candidate, title),
      dismissed: false,
    });
  }

  rows.sort((a, b) => b.score - a.score);
  await ctx.discover.replaceSuggestions(rows.slice(0, 80));
  await ctx.state.touch(DISCOVER_STATE_KEY, { suggestions: rows.length });

  return {
    scanned: recent.length,
    candidates: scored.length,
    resolved,
    skippedAlreadyKnown,
    suggestions: rows.length,
    quotaUsed: (await ctx.ledger.status()).used - before,
    ranAt: new Date().toISOString(),
    degraded,
  };
}
