import { NextResponse } from "next/server";
import { getAccessToken } from "@/lib/auth";
import { TTL_SECONDS, getFeed } from "@/lib/feed";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/** The cached feed as JSON. Handy for debugging what a refresh actually cost. */
export async function GET(request: Request) {
  const token = await getAccessToken();
  if (!token) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const force = new URL(request.url).searchParams.get("refresh") === "1";

  try {
    const { value, storedAt, fresh } = await getFeed(token, { force });
    return NextResponse.json({
      fetchedAt: new Date(storedAt).toISOString(),
      fresh,
      ttlSeconds: TTL_SECONDS,
      quotaUnitsUsed: value.quotaUnitsUsed,
      subscriptions: value.subscriptions.length,
      failedChannels: value.failedChannels,
      count: value.videos.length,
      videos: value.videos,
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
