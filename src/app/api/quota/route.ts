import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

export const dynamic = "force-dynamic";

/** Today's YouTube API spend, for the indicator in Settings. */
export async function GET() {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const status = await ctx.ledger.status();
  const { data } = await ctx.db
    .from("quota_log")
    .select("endpoint,units,outcome,created_at")
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(200);

  const byEndpoint = new Map<string, { calls: number; units: number }>();
  for (const row of data ?? []) {
    if (row.outcome !== "ok") continue;
    const entry = byEndpoint.get(row.endpoint) ?? { calls: 0, units: 0 };
    entry.calls += 1;
    entry.units += row.units;
    byEndpoint.set(row.endpoint, entry);
  }

  return NextResponse.json({
    ...status,
    breakdown: [...byEndpoint.entries()]
      .map(([endpoint, v]) => ({ endpoint, ...v }))
      .sort((a, b) => b.units - a.units),
  });
}
