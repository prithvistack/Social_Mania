import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { getChannelPage, parseSort, sortVideos } from "@/lib/feed";
import { YouTubeAuthError } from "@/lib/youtube";
import { QuotaBudgetError } from "@/lib/quota";
import { VideoList } from "@/components/VideoList";
import { SortTabs } from "@/components/SortTabs";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { compactNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ sort?: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { channelId } = await params;
  if (!isDbConfigured()) return { title: "Channel" };
  const ctx = await getContext();
  if (!ctx) return { title: "Channel" };
  const channel = await ctx.videos.getChannel(channelId);
  return { title: channel?.title ?? "Channel" };
}

export default async function ChannelPage({ params, searchParams }: Params) {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const { channelId } = await params;
  const sort = parseSort((await searchParams).sort);
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  let page;
  try {
    page = await getChannelPage(ctx, channelId);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof QuotaBudgetError) {
      return (
        <div className="py-16">
          <Notice title="Today's API budget is spent">
            This channel isn&apos;t cached yet. It will load after the quota resets.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  const { channel, videos, watchLater } = page;
  if (!channel && videos.length === 0) notFound();

  const sorted = sortVideos(videos, sort);
  const subs = compactNumber(channel?.subscriber_count ?? undefined);
  const total = compactNumber(channel?.video_count ?? undefined);
  const capped = channel?.video_count != null && channel.video_count > videos.length;

  return (
    <div className="py-10 sm:py-14">
      <header className="mb-8 flex items-start gap-5">
        {channel?.thumbnail && (
          <Image
            src={channel.thumbnail}
            alt=""
            width={72}
            height={72}
            className="h-14 w-14 shrink-0 rounded-full bg-raised sm:h-[72px] sm:w-[72px]"
          />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[22px] font-medium tracking-tight">
            {channel?.title ?? "Channel"}
          </h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {subs && <span className="tabular-nums">{subs} subscribers</span>}
            {subs && total && <span className="text-faint">·</span>}
            {total && <span className="tabular-nums">{total} videos</span>}
            {channel && !channel.is_subscribed && (
              <>
                <span className="text-faint">·</span>
                <span className="text-faint">not subscribed</span>
              </>
            )}
          </div>
          {channel?.description && (
            <p className="line-clamp-2-safe max-w-2xl text-[13px] leading-relaxed text-muted">
              {channel.description}
            </p>
          )}
        </div>
      </header>

      <div className="mb-9 flex flex-col gap-2">
        <SortTabs basePath={`/channel/${channelId}`} active={sort} />
        {capped && (
          <p className="text-[12px] text-faint">
            Showing the {videos.length} uploads cached so far. Sorting by views or likes
            ranks within these.
          </p>
        )}
      </div>

      {sorted.length === 0 ? (
        <Notice title="No public uploads">
          This channel has nothing readable through the API.
        </Notice>
      ) : (
        <VideoList
          videos={sorted}
          showChannel={false}
          grouped={sort === "newest"}
          watchLater={watchLater}
        />
      )}
    </div>
  );
}
