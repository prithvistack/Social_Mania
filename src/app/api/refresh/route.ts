import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getAccessToken } from "@/lib/auth";
import { getFeed, invalidateFeed } from "@/lib/feed";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/**
 * Forces a rebuild of the feed cache.
 *
 * Note this needs the signed-in user's cookie — it can't be driven by a Vercel
 * Cron job, because the OAuth refresh token lives in the session cookie and
 * nowhere else. Hourly freshness comes from FEED_TTL_SECONDS instead: the first
 * page view after the TTL lapses does the refetch.
 */
export async function POST() {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    await invalidateFeed();
    const { value } = await getFeed(token, { force: true });
    revalidatePath("/");
    return NextResponse.json({
      ok: true,
      videos: value.videos.length,
      subscriptions: value.subscriptions.length,
      quotaUnitsUsed: value.quotaUnitsUsed,
    });
  } catch (err) {
    if (err instanceof YouTubeAuthError) {
      return NextResponse.json({ error: "Sign in again" }, { status: 401 });
    }
    if (err instanceof YouTubeQuotaError) {
      return NextResponse.json({ error: "Daily quota exhausted" }, { status: 429 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
