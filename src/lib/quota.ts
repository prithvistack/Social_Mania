import type { DbLike } from "./db/types";

/**
 * Documented unit costs for the endpoints this app touches.
 * https://developers.google.com/youtube/v3/determine_quota_cost
 */
export const QUOTA_COSTS = {
  "subscriptions.list": 1,
  "playlistItems.list": 1,
  "playlists.list": 1,
  "videos.list": 1,
  "channels.list": 1,
  "search.list": 100,
} as const;

export type QuotaEndpoint = keyof typeof QUOTA_COSTS;

export const DEFAULT_DAILY_BUDGET = 8000;
/**
 * Units held back from the budget so an explicit action the user is waiting on
 * (a manual "Search all of YouTube") isn't blocked by background refreshes.
 */
export const DEFAULT_RESERVE = 500;

const TZ = "America/Los_Angeles";

function tzOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") % 24,
    get("minute"),
    get("second"),
  );
  return asUtc - at.getTime();
}

/**
 * YouTube's quota resets at midnight Pacific, not midnight UTC or local time.
 * Getting this wrong would either under-count (and blow the budget) or
 * over-count (and refuse calls that are actually free).
 */
export function pacificDayStart(now: Date = new Date()): Date {
  const offset = tzOffsetMs(now, TZ);
  const shifted = new Date(now.getTime() + offset);
  const midnight = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );

  let utc = midnight - offset;
  // Recheck across a DST boundary, where the offset at midnight differs from
  // the offset right now.
  const offsetAtMidnight = tzOffsetMs(new Date(utc), TZ);
  if (offsetAtMidnight !== offset) utc = midnight - offsetAtMidnight;
  return new Date(utc);
}

export class QuotaBudgetError extends Error {
  readonly used: number;
  readonly budget: number;
  readonly requested: number;

  constructor(used: number, budget: number, requested: number) {
    super(
      `Refusing a ${requested}-unit YouTube call: ${used}/${budget} of today's ` +
        `budget is already spent. Serving cached data instead.`,
    );
    this.name = "QuotaBudgetError";
    this.used = used;
    this.budget = budget;
    this.requested = requested;
  }
}

export type BudgetDecision = { allowed: boolean; reason?: string };

/**
 * Pure budget arithmetic, kept separate from the database so it can be
 * reasoned about and tested on its own.
 *
 * `reserve` is only honoured for background work. A call the user explicitly
 * asked for may dip into it, but still never past the hard budget.
 */
export function budgetDecision(opts: {
  used: number;
  requested: number;
  budget: number;
  reserve?: number;
  interactive?: boolean;
}): BudgetDecision {
  const { used, requested, budget, reserve = 0, interactive = false } = opts;
  if (requested <= 0) return { allowed: true };

  if (used + requested > budget) {
    return {
      allowed: false,
      reason: `would exceed the daily budget (${used} + ${requested} > ${budget})`,
    };
  }
  if (!interactive && used + requested > budget - reserve) {
    return {
      allowed: false,
      reason: `would eat into the ${reserve}-unit reserve kept for interactive searches`,
    };
  }
  return { allowed: true };
}

export type SpendOptions = {
  /** Interactive calls may use the reserve; background refreshes may not. */
  interactive?: boolean;
  /** Skip the budget check but still log. Used for calls already counted. */
  units?: number;
};

export type QuotaLedger = ReturnType<typeof createQuotaLedger>;

/**
 * Every YouTube API call in the app goes through `ledger.spend`. Nothing calls
 * googleapis.com without passing through here first, which is what makes the
 * ledger's numbers trustworthy rather than an estimate.
 */
export function createQuotaLedger(
  db: DbLike,
  opts: { budget?: number; reserve?: number; now?: () => Date } = {},
) {
  const budget = opts.budget ?? DEFAULT_DAILY_BUDGET;
  const reserve = opts.reserve ?? DEFAULT_RESERVE;
  const now = opts.now ?? (() => new Date());

  async function log(
    endpoint: string,
    units: number,
    outcome: "ok" | "error" | "refused",
    detail?: string,
  ) {
    try {
      await db.from("quota_log").insert({
        endpoint,
        units,
        outcome,
        detail: detail ?? null,
        created_at: now().toISOString(),
      });
    } catch {
      // The ledger must never be the reason a request fails. A dropped log
      // line is strictly better than a broken feed.
    }
  }

  async function usedToday(): Promise<number> {
    const since = pacificDayStart(now()).toISOString();
    try {
      const { data, error } = await db.rpc("quota_used_since", { since });
      if (error) throw error;
      return Number(data ?? 0);
    } catch {
      // Falling back to a direct scan keeps this working before the helper
      // function exists (e.g. an older schema).
      try {
        const { data } = await db
          .from("quota_log")
          .select("units")
          .gte("created_at", since)
          .eq("outcome", "ok");
        return (data ?? []).reduce(
          (sum: number, row: { units: number }) => sum + row.units,
          0,
        );
      } catch {
        return 0;
      }
    }
  }

  return {
    budget,
    reserve,
    usedToday,

    async status() {
      const used = await usedToday();
      return {
        used,
        budget,
        remaining: Math.max(0, budget - used),
        percent: budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0,
        resetsAt: new Date(pacificDayStart(now()).getTime() + 86_400_000).toISOString(),
      };
    },

    /** True when a background caller should skip the API and use cache. */
    async canSpend(endpoint: QuotaEndpoint, interactive = false): Promise<boolean> {
      const requested = QUOTA_COSTS[endpoint];
      const used = await usedToday();
      return budgetDecision({ used, requested, budget, reserve, interactive }).allowed;
    },

    /**
     * Runs `fn` if the budget allows, logging the cost either way.
     * Throws QuotaBudgetError when refused, so callers can fall back to cache.
     */
    async spend<T>(
      endpoint: QuotaEndpoint,
      fn: () => Promise<T>,
      options: SpendOptions = {},
    ): Promise<T> {
      const requested = options.units ?? QUOTA_COSTS[endpoint];
      const used = await usedToday();
      const decision = budgetDecision({
        used,
        requested,
        budget,
        reserve,
        interactive: options.interactive,
      });

      if (!decision.allowed) {
        await log(endpoint, 0, "refused", decision.reason);
        throw new QuotaBudgetError(used, budget, requested);
      }

      try {
        const result = await fn();
        await log(endpoint, requested, "ok");
        return result;
      } catch (err) {
        // A failed call still costs quota at Google's end, so it is logged at
        // full price. Under-counting here is what causes a budget overrun.
        await log(endpoint, requested, "error", (err as Error).message.slice(0, 300));
        throw err;
      }
    },
  };
}
