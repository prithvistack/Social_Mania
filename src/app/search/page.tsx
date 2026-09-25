import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { YOUTUBE_SEARCH_COST, searchLocal } from "@/lib/search";
import { PageHeading } from "@/components/PageHeading";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { VideoList } from "@/components/VideoList";
import { YouTubeSearchPanel } from "@/components/SearchClient";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  const query = String((await searchParams).q ?? "").slice(0, 200);
  const local = await searchLocal(ctx, query);
  const watchLater = await ctx.watchLater.ids();

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="Search"
        meta={<span>Your feed, history and queue. No quota cost.</span>}
      />

      <form action="/search" method="get" className="mb-10 flex gap-2">
        <input
          name="q"
          defaultValue={query}
          autoFocus
          placeholder="Search everything you've cached…"
          className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 text-[14px] text-ink placeholder:text-faint"
        />
        <button
          type="submit"
          className="rounded-[var(--radius-card)] border border-line px-4 py-2.5 text-[13px] transition-colors hover:border-accent hover:text-accent"
        >
          Search
        </button>
      </form>

      {query && (
        <p className="mb-6 text-[12px] text-faint tabular-nums">
          {local.hits.length} local {local.hits.length === 1 ? "result" : "results"}
          {local.counts.history > 0 && ` · ${local.counts.history} in your history`}
          {local.counts.watchLater > 0 && ` · ${local.counts.watchLater} saved for later`}
        </p>
      )}

      {query && local.hits.length === 0 && (
        <Notice title="Nothing cached matches that">
          Your local cache has no match. You can spend {YOUTUBE_SEARCH_COST} quota units to
          search all of YouTube below.
        </Notice>
      )}

      {local.hits.length > 0 && (
        <VideoList videos={local.hits} grouped={false} watchLater={watchLater} />
      )}

      <YouTubeSearchPanel query={query} cost={YOUTUBE_SEARCH_COST} />
    </div>
  );
}
