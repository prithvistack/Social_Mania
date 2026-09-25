import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

export const dynamic = "force-dynamic";

/**
 * Receives playback progress from the player. Called periodically and, via
 * sendBeacon, on page unload — so it must stay cheap and never block.
 */
export async function POST(request: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const videoId = String(body?.videoId ?? "");
  // Client input is never trusted: ids are shape-checked and numbers clamped.
  if (!/^[\w-]{5,20}$/.test(videoId)) {
    return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
  }

  const clamp = (value: unknown, max = 86_400) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), max) : 0;
  };

  const duration = clamp(body?.durationSeconds) || null;
  await ctx.history.recordProgress({
    videoId,
    channelId: String(body?.channelId ?? "").slice(0, 32),
    positionSeconds: clamp(body?.positionSeconds),
    secondsWatched: clamp(body?.secondsWatched),
    durationSeconds: duration,
  });

  return NextResponse.json({ ok: true });
}
