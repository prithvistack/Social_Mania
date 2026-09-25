import type { DbLike } from "./types";

/** Tiny key/value store for job bookkeeping (last sync, last discovery run). */
export function createStateRepo(db: DbLike, now: () => Date = () => new Date()) {
  return {
    async get<T>(key: string): Promise<T | null> {
      const { data } = await db
        .from("app_state")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      return (data?.value as T) ?? null;
    },

    async set(key: string, value: unknown): Promise<void> {
      await db
        .from("app_state")
        .upsert({ key, value, updated_at: now().toISOString() }, { onConflict: "key" });
    },

    /** True when `key` has not been written within `maxAgeMs`. */
    async isStale(key: string, maxAgeMs: number): Promise<boolean> {
      const state = await this.get<{ at?: string }>(key);
      if (!state?.at) return true;
      return now().getTime() - new Date(state.at).getTime() > maxAgeMs;
    },

    async touch(key: string, extra: Record<string, unknown> = {}): Promise<void> {
      await this.set(key, { at: now().toISOString(), ...extra });
    },
  };
}
