import type {
  DbLike,
  PlaybackPositionRow,
  WatchHistoryRow,
  WatchLaterRow,
} from "./types";

/** A video is "finished" once the player has reported 90% of its duration. */
export const COMPLETE_FRACTION = 0.9;
/** Past this point there is nothing left to resume, so the position is dropped. */
export const RESUME_CLEAR_FRACTION = 0.95;
/** Below this, a view is noise — a misclick or a two-second preview. */
export const MIN_TRACKED_SECONDS = 10;
/** A second visit inside this window updates the existing row rather than adding one. */
export const SESSION_MERGE_MINUTES = 30;

export type ProgressReport = {
  videoId: string;
  channelId: string;
  positionSeconds: number;
  secondsWatched: number;
  durationSeconds?: number | null;
};

/**
 * Derived data that is rebuilt from watch history. Deleting history has to
 * clear all of it, or the app would keep showing recommendations justified by
 * videos the user has just erased.
 */
export const DERIVED_STATE_KEYS = ["topic_profile", "discover:last_run"] as const;

export type HistoryRepo = ReturnType<typeof createHistoryRepo>;

export function createHistoryRepo(db: DbLike, now: () => Date = () => new Date()) {
  /**
   * Wipes everything computed from watch history. Called after every deletion
   * path, so a removed video can never keep influencing what gets suggested.
   */
  async function clearDerived(): Promise<void> {
    // Discovery reasons quote specific watched videos, so they are rebuilt
    // wholesale rather than patched.
    await db.from("discovered_channels").delete().eq("dismissed", false);
    await db.from("app_state").delete().in("key", [...DERIVED_STATE_KEYS]);
  }

  /** Drops resume points for videos that no longer appear in history at all. */
  async function pruneOrphanedPositions(videoIds: string[]): Promise<void> {
    const unique = [...new Set(videoIds)].filter(Boolean);
    if (unique.length === 0) return;

    const { data } = await db
      .from("watch_history")
      .select("video_id")
      .in("video_id", unique);

    const stillWatched = new Set(
      (data ?? []).map((row: { video_id: string }) => row.video_id),
    );
    const orphaned = unique.filter((id) => !stillWatched.has(id));
    if (orphaned.length > 0) {
      await db.from("playback_positions").delete().in("video_id", orphaned);
    }
  }

  return {
    clearDerived,

    /**
     * Records progress. Repeated pings for the same video inside one sitting
     * update a single row instead of filling history with duplicates.
     */
    async recordProgress(report: ProgressReport): Promise<void> {
      const at = now();
      const duration = report.durationSeconds ?? null;
      const completed =
        duration != null && duration > 0
          ? report.positionSeconds >= duration * COMPLETE_FRACTION
          : false;

      if (report.secondsWatched >= MIN_TRACKED_SECONDS) {
        const cutoff = new Date(
          at.getTime() - SESSION_MERGE_MINUTES * 60_000,
        ).toISOString();

        const { data: recent } = await db
          .from("watch_history")
          .select("id,seconds_watched")
          .eq("video_id", report.videoId)
          .gte("watched_at", cutoff)
          .order("watched_at", { ascending: false })
          .limit(1);

        const existing = (recent ?? [])[0];
        if (existing) {
          await db
            .from("watch_history")
            .update({
              seconds_watched: Math.max(existing.seconds_watched, report.secondsWatched),
              completed,
              watched_at: at.toISOString(),
            })
            .eq("id", existing.id);
        } else {
          await db.from("watch_history").insert({
            video_id: report.videoId,
            channel_id: report.channelId,
            seconds_watched: report.secondsWatched,
            completed,
            watched_at: at.toISOString(),
          });
        }
      }

      // Resume point. Cleared once there is effectively nothing left to watch.
      const nearlyDone =
        duration != null && duration > 0
          ? report.positionSeconds >= duration * RESUME_CLEAR_FRACTION
          : false;

      if (nearlyDone || report.positionSeconds < MIN_TRACKED_SECONDS) {
        await db.from("playback_positions").delete().eq("video_id", report.videoId);
      } else {
        await db.from("playback_positions").upsert(
          {
            video_id: report.videoId,
            position_seconds: Math.floor(report.positionSeconds),
            duration_seconds: duration,
            updated_at: at.toISOString(),
          },
          { onConflict: "video_id" },
        );
      }
    },

    async getPosition(videoId: string): Promise<PlaybackPositionRow | null> {
      const { data } = await db
        .from("playback_positions")
        .select("*")
        .eq("video_id", videoId)
        .maybeSingle();
      return (data as PlaybackPositionRow) ?? null;
    },

    /**
     * Every resume point. The table only holds unfinished videos, so it stays
     * small, and fetching it whole lets callers run this in parallel instead
     * of waiting for a list of ids first.
     */
    async allPositions(): Promise<Map<string, number>> {
      const { data } = await db
        .from("playback_positions")
        .select("video_id,position_seconds");
      return new Map(
        (data ?? []).map((r: PlaybackPositionRow) => [r.video_id, r.position_seconds]),
      );
    },

    async getPositions(videoIds: string[]): Promise<Map<string, number>> {
      if (videoIds.length === 0) return new Map();
      const { data } = await db
        .from("playback_positions")
        .select("video_id,position_seconds")
        .in("video_id", videoIds);
      return new Map(
        (data ?? []).map((r: PlaybackPositionRow) => [r.video_id, r.position_seconds]),
      );
    },

    async list(limit = 200): Promise<WatchHistoryRow[]> {
      const { data } = await db
        .from("watch_history")
        .select("*")
        .order("watched_at", { ascending: false })
        .limit(limit);
      return (data ?? []) as WatchHistoryRow[];
    },

    async since(iso: string): Promise<WatchHistoryRow[]> {
      const { data } = await db
        .from("watch_history")
        .select("*")
        .gte("watched_at", iso)
        .order("watched_at", { ascending: false });
      return (data ?? []) as WatchHistoryRow[];
    },

    /** Video ids that have been watched to >= 90%, for course progress. */
    async completedVideoIds(): Promise<Set<string>> {
      const { data } = await db
        .from("watch_history")
        .select("video_id")
        .eq("completed", true);
      return new Set((data ?? []).map((r: { video_id: string }) => r.video_id));
    },

    // --- deletion, all three paths cascading through clearDerived ----------

    async deleteEntry(id: number): Promise<void> {
      const { data } = await db
        .from("watch_history")
        .select("video_id")
        .eq("id", id)
        .maybeSingle();
      const videoId = (data as { video_id: string } | null)?.video_id;

      await db.from("watch_history").delete().eq("id", id);
      if (videoId) await pruneOrphanedPositions([videoId]);
      await clearDerived();
    },

    async deleteRange(fromIso: string, toIso: string): Promise<number> {
      const { data: doomed } = await db
        .from("watch_history")
        .select("video_id")
        .gte("watched_at", fromIso)
        .lte("watched_at", toIso);

      const videoIds = (doomed ?? []).map((r: { video_id: string }) => r.video_id);

      await db
        .from("watch_history")
        .delete()
        .gte("watched_at", fromIso)
        .lte("watched_at", toIso);

      await pruneOrphanedPositions(videoIds);
      await clearDerived();
      return videoIds.length;
    },

    async clearAll(): Promise<void> {
      await db.from("watch_history").delete().neq("id", -1);
      // With no history left, every resume point is orphaned by definition.
      await db.from("playback_positions").delete().neq("video_id", "");
      await clearDerived();
    },
  };
}

export type WatchLaterRepo = ReturnType<typeof createWatchLaterRepo>;

export function createWatchLaterRepo(db: DbLike, now: () => Date = () => new Date()) {
  return {
    async list(): Promise<WatchLaterRow[]> {
      const { data } = await db
        .from("watch_later")
        .select("*")
        .order("added_at", { ascending: false });
      return (data ?? []) as WatchLaterRow[];
    },

    async ids(): Promise<Set<string>> {
      const { data } = await db.from("watch_later").select("video_id");
      return new Set((data ?? []).map((r: { video_id: string }) => r.video_id));
    },

    async add(videoId: string): Promise<void> {
      await db
        .from("watch_later")
        .upsert(
          { video_id: videoId, added_at: now().toISOString() },
          { onConflict: "video_id" },
        );
    },

    async remove(videoId: string): Promise<void> {
      await db.from("watch_later").delete().eq("video_id", videoId);
    },

    async toggle(videoId: string): Promise<boolean> {
      const { data } = await db
        .from("watch_later")
        .select("video_id")
        .eq("video_id", videoId)
        .maybeSingle();

      if (data) {
        await this.remove(videoId);
        return false;
      }
      await this.add(videoId);
      return true;
    },
  };
}
