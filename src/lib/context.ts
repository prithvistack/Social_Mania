import "server-only";

import { getAccessToken } from "./auth";
import { getDb, isDbConfigured, isSchemaReady } from "./db/client";
import { createVideoRepo } from "./db/videos";
import { createHistoryRepo, createWatchLaterRepo } from "./db/history";
import { createStateRepo } from "./db/state";
import { createDiscoverRepo } from "./db/discover";
import { createCourseRepo } from "./db/courses";
import { DEFAULT_DAILY_BUDGET, createQuotaLedger } from "./quota";
import { createYouTubeClient } from "./youtube";

export { isDbConfigured, isSchemaReady };

function budget(): number {
  const raw = Number(process.env.YT_DAILY_BUDGET);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET;
}

export type AppContext = Awaited<ReturnType<typeof buildContext>>;

function buildContext(token: string) {
  const db = getDb();
  const ledger = createQuotaLedger(db, { budget: budget() });
  return {
    token,
    db,
    ledger,
    client: createYouTubeClient({ token, ledger }),
    videos: createVideoRepo(db),
    history: createHistoryRepo(db),
    watchLater: createWatchLaterRepo(db),
    state: createStateRepo(db),
    discover: createDiscoverRepo(db),
    courses: createCourseRepo(db),
  };
}

/**
 * The single entry point every server component and route handler uses.
 * Returns null when the user is signed out, so callers redirect rather than
 * half-render.
 */
export async function getContext(): Promise<AppContext | null> {
  const token = await getAccessToken();
  if (!token) return null;
  return buildContext(token);
}

/** Read-only context for pages that only touch the cache, never YouTube. */
export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) throw new Error("Not signed in");
  return ctx;
}
