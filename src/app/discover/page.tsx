import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { runDiscovery } from "@/lib/discovery";
import { DISCOVER_STATE_KEY } from "@/lib/db/discover";
import { QuotaBudgetError } from "@/lib/quota";
import { buildTopicProfile, deriveCategory, rankCategories } from "@/lib/topics";
import { PageHeading } from "@/components/PageHeading";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { DiscoverCard } from "@/components/DiscoverCard";
import { RefreshDiscoverButton } from "@/components/RefreshDiscoverButton";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Discover" };

export default async function DiscoverPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  // Recomputes at most once a day; otherwise this is a pure cache read.
  try {
    await runDiscovery(ctx);
  } catch (err) {
    if (!(err instanceof QuotaBudgetError)) throw err;
  }

  const suggestions = await ctx.discover.list(60);
  const lastRun = await ctx.state.get<{ at?: string }>(DISCOVER_STATE_KEY);

  // Order the category sections by what the user actually watches.
  const history = await ctx.history.list(500);
  const watchedVideos = await ctx.videos.getVideos([
    ...new Set(history.map((h) => h.video_id)),
  ]);
  const secondsByVideo = new Map(history.map((h) => [h.video_id, h.seconds_watched]));
  const profile = buildTopicProfile(
    watchedVideos.map((v) => ({
      // Derive the category from the video itself; the suggestion list only
      // covers channels that aren't subscribed to, so it says nothing about
      // what has actually been watched.
      category: deriveCategory({
        title: v.title,
        description: v.description,
        tags: v.tags,
      }),
      secondsWatched: secondsByVideo.get(v.id) ?? 0,
    })),
  );

  const grouped = new Map<string, typeof suggestions>();
  for (const suggestion of suggestions) {
    const list = grouped.get(suggestion.category) ?? [];
    list.push(suggestion);
    grouped.set(suggestion.category, list);
  }
  const ordered = rankCategories(profile, [...grouped.keys()]);

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="Discover"
        meta={
          <>
            <span>Channels your creators collaborate with or mention</span>
            {lastRun?.at && (
              <>
                <span>·</span>
                <span>computed {timeAgo(lastRun.at)}</span>
              </>
            )}
          </>
        }
      >
        <RefreshDiscoverButton />
      </PageHeading>

      {suggestions.length === 0 ? (
        <Notice title="Nothing to suggest yet">
          Discovery reads the descriptions and titles of videos already in your cache,
          looking for @handles, channel links and podcast guests. Once you have a full feed
          — and some watch history to weight it — suggestions will appear here.
        </Notice>
      ) : (
        <div className="flex flex-col gap-12">
          {ordered.map((category) => (
            <section key={category} className="flex flex-col gap-4">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                {category}
              </h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {(grouped.get(category) ?? []).map((suggestion) => (
                  <DiscoverCard key={suggestion.channel_id} suggestion={suggestion} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
