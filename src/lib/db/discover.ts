import type { DbLike, DiscoveredChannelRow, HandleResolutionRow } from "./types";

export const DISCOVER_STATE_KEY = "discover:last_run";
/** Recompute discovery at most once a day, as specified. */
export const DISCOVER_INTERVAL_MS = 24 * 3_600_000;

export type DiscoverRepo = ReturnType<typeof createDiscoverRepo>;

export function createDiscoverRepo(db: DbLike, now: () => Date = () => new Date()) {
  return {
    /**
     * Handles we have already spent a unit resolving — including the ones that
     * resolved to nothing. Both outcomes are permanent, which is what makes
     * "never re-resolve a known handle" true rather than aspirational.
     */
    async knownHandles(handles: string[]): Promise<Map<string, string | null>> {
      if (handles.length === 0) return new Map();
      const out = new Map<string, string | null>();
      const lowered = handles.map((h) => h.toLowerCase());
      for (let i = 0; i < lowered.length; i += 200) {
        const { data } = await db
          .from("handle_resolutions")
          .select("*")
          .in("handle", lowered.slice(i, i + 200));
        for (const row of (data ?? []) as HandleResolutionRow[]) {
          out.set(row.handle, row.channel_id);
        }
      }
      return out;
    },

    async recordResolution(handle: string, channelId: string | null): Promise<void> {
      await db.from("handle_resolutions").upsert(
        {
          handle: handle.toLowerCase(),
          channel_id: channelId,
          resolved_at: now().toISOString(),
        },
        { onConflict: "handle" },
      );
    },

    async replaceSuggestions(rows: Partial<DiscoveredChannelRow>[]): Promise<void> {
      // Dismissed rows are preserved so a rejected channel stays rejected.
      await db.from("discovered_channels").delete().eq("dismissed", false);
      if (rows.length === 0) return;
      await db.from("discovered_channels").upsert(
        rows.map((r) => ({ ...r, computed_at: now().toISOString() })),
        { onConflict: "channel_id" },
      );
    },

    async list(limit = 60): Promise<DiscoveredChannelRow[]> {
      const { data } = await db
        .from("discovered_channels")
        .select("*")
        .eq("dismissed", false)
        .order("score", { ascending: false })
        .limit(limit);
      return (data ?? []) as DiscoveredChannelRow[];
    },

    async dismiss(channelId: string): Promise<void> {
      await db
        .from("discovered_channels")
        .update({ dismissed: true })
        .eq("channel_id", channelId);
    },

    async dismissedIds(): Promise<Set<string>> {
      const { data } = await db
        .from("discovered_channels")
        .select("channel_id")
        .eq("dismissed", true);
      return new Set((data ?? []).map((r: { channel_id: string }) => r.channel_id));
    },
  };
}
