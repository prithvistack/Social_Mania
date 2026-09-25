import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { FEED_TTL_SECONDS, getFeedPage, refreshNow } from "@/lib/feed";
import { QuotaBudgetError } from "@/lib/quota";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/** The cached feed as JSON, plus what the last sync cost. */
export async function GET(request: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const force = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const sync = force ? await refreshNow(ctx) : null;
    const page = await getFeedPage(ctx);
    return NextResponse.json({
      lastSyncedAt: page.lastSyncedAt,
      ttlSeconds: FEED_TTL_SECONDS,
      channels: page.channels,
      count: page.videos.length,
      quota: await ctx.ledger.status(),
      sync,
      videos: page.videos.slice(0, 100),
    });
  } catch (err) {
    if (err instanceof YouTubeAuthError) {
      return NextResponse.json({ error: "Sign in again" }, { status: 401 });
    }
    if (err instanceof QuotaBudgetError || err instanceof YouTubeQuotaError) {
      return NextResponse.json({ error: (err as Error).message }, { status: 429 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
