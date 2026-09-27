import "server-only";

import { buildTopicProfile, deriveCategory } from "./topics";
import type { AppContext } from "./context";

export type DigestChannel = { channelId: string; title: string; seconds: number; videos: number };

export type Digest = {
  from: string;
  to: string;
  totalSeconds: number;
  videoCount: number;
  categories: { category: string; seconds: number; share: number }[];
  channels: DigestChannel[];
  courses: { title: string; completed: number; total: number }[];
  /** Same figures for the previous seven days, for a plain comparison. */
  previousSeconds: number;
};

/**
 * Computed entirely from Supabase — zero quota. Deliberately plain: hours,
 * categories, channels, course progress. No streaks, no goals, no badges.
 */
export async function buildDigest(ctx: AppContext, days = 7): Promise<Digest> {
  const now = Date.now();
  const from = new Date(now - days * 86_400_000);
  const previousFrom = new Date(now - 2 * days * 86_400_000);

  // The courses chain doesn't depend on this week's history, so it runs
  // alongside it instead of after it.
  const coursesPromise = ctx.history
    .completedVideoIds()
    .then((completed) => ctx.courses.summaries(completed));

  const recent = await ctx.history.since(previousFrom.toISOString());
  const thisWeek = recent.filter((h) => new Date(h.watched_at) >= from);
  const lastWeek = recent.filter((h) => new Date(h.watched_at) < from);

  const videoIds = [...new Set(thisWeek.map((h) => h.video_id))];
  const videos = await ctx.videos.getVideos(videoIds);
  const byId = new Map(videos.map((v) => [v.id, v]));

  const categorySeconds = new Map<string, number>();
  const channelTotals = new Map<string, DigestChannel>();

  for (const row of thisWeek) {
    const video = byId.get(row.video_id);
    const seconds = Math.max(0, row.seconds_watched);

    const category = video
      ? deriveCategory({ title: video.title, description: video.description, tags: video.tags })
      : "Other";
    categorySeconds.set(category, (categorySeconds.get(category) ?? 0) + seconds);

    const channelId = row.channel_id || video?.channelId || "unknown";
    const existing = channelTotals.get(channelId) ?? {
      channelId,
      title: video?.channelTitle || "Unknown channel",
      seconds: 0,
      videos: 0,
    };
    existing.seconds += seconds;
    existing.videos += 1;
    if (video?.channelTitle) existing.title = video.channelTitle;
    channelTotals.set(channelId, existing);
  }

  const totalSeconds = thisWeek.reduce((s, h) => s + Math.max(0, h.seconds_watched), 0);
  const profile = buildTopicProfile(
    [...categorySeconds.entries()].map(([category, seconds]) => ({
      category,
      secondsWatched: seconds,
    })),
  );

  const courses = await coursesPromise;

  return {
    from: from.toISOString(),
    to: new Date(now).toISOString(),
    totalSeconds,
    videoCount: new Set(thisWeek.map((h) => h.video_id)).size,
    categories: profile.map((p) => ({
      category: p.category,
      seconds: p.weight,
      share: totalSeconds > 0 ? p.weight / totalSeconds : 0,
    })),
    channels: [...channelTotals.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 8),
    courses: courses.map((c) => ({
      title: c.playlist.title,
      completed: c.completed,
      total: c.total,
    })),
    previousSeconds: lastWeek.reduce((s, h) => s + Math.max(0, h.seconds_watched), 0),
  };
}
