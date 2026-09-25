import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { searchYouTube } from "@/lib/search";
import { QuotaBudgetError } from "@/lib/quota";
import { YouTubeQuotaError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/**
 * The paid search. POST-only and never called on render, so a 100-unit
 * search can only happen because the user clicked the button.
 */
export async function POST(request: Request) {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const query = String(body?.q ?? "").trim().slice(0, 200);
  if (!query) return NextResponse.json({ error: "Empty query" }, { status: 400 });

  try {
    return NextResponse.json(await searchYouTube(ctx, query));
  } catch (err) {
    if (err instanceof QuotaBudgetError || err instanceof YouTubeQuotaError) {
      return NextResponse.json({ error: (err as Error).message }, { status: 429 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
