import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/context";
import { refreshNow } from "@/lib/feed";
import { QuotaBudgetError } from "@/lib/quota";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";

export const dynamic = "force-dynamic";

/**
 * Forces a feed sync. Mostly free — the uploads come from RSS, and only
 * genuinely new video IDs cost anything.
 */
export async function POST() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  try {
    const result = await refreshNow(ctx);
    revalidatePath("/");
    return NextResponse.json({ ok: true, ...result });
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
