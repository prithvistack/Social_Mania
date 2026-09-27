import type { CourseProgressRow, DbLike, PlaylistItemRow, PlaylistRow } from "./types";

/** Curated course playlists are cached for a week, as specified. */
export const PLAYLIST_TTL_MS = 7 * 24 * 3_600_000;
/** A lecture counts as done at 90% watched. */
export const LECTURE_COMPLETE_FRACTION = 0.9;

export type CourseSummary = {
  playlist: PlaylistRow;
  items: PlaylistItemRow[];
  completed: number;
  total: number;
  /** The first lecture not yet finished, for the Continue button. */
  nextVideoId: string | null;
  nextTitle: string | null;
  startedAt: string;
  reason: string;
};

export type CourseRepo = ReturnType<typeof createCourseRepo>;

export function createCourseRepo(db: DbLike, now: () => Date = () => new Date()) {
  return {
    async getPlaylist(playlistId: string): Promise<PlaylistRow | null> {
      const { data } = await db
        .from("playlists")
        .select("*")
        .eq("playlist_id", playlistId)
        .maybeSingle();
      return (data as PlaylistRow) ?? null;
    },

    /** Cached playlists for a channel that are still inside the 7-day TTL. */
    async freshPlaylistsForChannel(channelId: string): Promise<PlaylistRow[]> {
      const cutoff = new Date(now().getTime() - PLAYLIST_TTL_MS).toISOString();
      const { data } = await db
        .from("playlists")
        .select("*")
        .eq("channel_id", channelId)
        .gte("fetched_at", cutoff);
      return (data ?? []) as PlaylistRow[];
    },

    async upsertPlaylists(playlists: Partial<PlaylistRow>[]): Promise<void> {
      if (playlists.length === 0) return;
      await db.from("playlists").upsert(
        playlists.map((p) => ({ ...p, fetched_at: now().toISOString() })),
        { onConflict: "playlist_id" },
      );
    },

    async setPlaylistItems(
      playlistId: string,
      items: { videoId: string; title: string; position: number }[],
    ): Promise<void> {
      if (items.length === 0) return;
      await db.from("playlist_items").upsert(
        items.map((i) => ({
          playlist_id: playlistId,
          video_id: i.videoId,
          title: i.title,
          position: i.position,
        })),
        { onConflict: "playlist_id,video_id" },
      );
    },

    async playlistItems(playlistId: string): Promise<PlaylistItemRow[]> {
      const { data } = await db
        .from("playlist_items")
        .select("*")
        .eq("playlist_id", playlistId)
        .order("position", { ascending: true });
      return (data ?? []) as PlaylistItemRow[];
    },

    async start(playlistId: string, reason: string): Promise<void> {
      await db.from("course_progress").upsert(
        { playlist_id: playlistId, reason, started_at: now().toISOString(), archived_at: null },
        { onConflict: "playlist_id" },
      );
    },

    async archive(playlistId: string): Promise<void> {
      await db
        .from("course_progress")
        .update({ archived_at: now().toISOString() })
        .eq("playlist_id", playlistId);
    },

    async enrollments(): Promise<CourseProgressRow[]> {
      const { data } = await db
        .from("course_progress")
        .select("*")
        .is("archived_at", null)
        .order("started_at", { ascending: false });
      return (data ?? []) as CourseProgressRow[];
    },

    /**
     * Progress is derived from watch history rather than stored separately,
     * so clearing history correctly resets it with no second bookkeeping.
     */
    async summaries(completedVideoIds: Set<string>): Promise<CourseSummary[]> {
      const enrolled = await this.enrollments();
      // Each course's playlist and lectures load in parallel, not one after
      // another — every sequential query is a full database round trip.
      const loaded = await Promise.all(
        enrolled.map(async (row) => {
          const [playlist, items] = await Promise.all([
            this.getPlaylist(row.playlist_id),
            this.playlistItems(row.playlist_id),
          ]);
          return { row, playlist, items };
        }),
      );

      const out: CourseSummary[] = [];
      for (const { row, playlist, items } of loaded) {
        if (!playlist) continue;
        const next = items.find((i) => !completedVideoIds.has(i.video_id)) ?? null;

        out.push({
          playlist,
          items,
          completed: items.filter((i) => completedVideoIds.has(i.video_id)).length,
          total: items.length,
          nextVideoId: next?.video_id ?? null,
          nextTitle: next?.title ?? null,
          startedAt: row.started_at,
          reason: row.reason,
        });
      }
      return out;
    },
  };
}
