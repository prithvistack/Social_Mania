import Image from "next/image";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAccessToken } from "@/lib/auth";
import { config, getChannelCatalogue, sortVideos, type SortKey } from "@/lib/feed";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";
import { VideoList } from "@/components/VideoList";
import { SortTabs } from "@/components/SortTabs";
import { Notice } from "@/components/Notice";
import { compactNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Params = {
  params: Promise<{ channelId: string }>;
  searchParams: Promise<{ sort?: string }>;
};

const SORTS = new Set<SortKey>(["newest", "views", "likes"]);
const parseSort = (value: string | undefined): SortKey =>
  SORTS.has(value as SortKey) ? (value as SortKey) : "newest";

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { channelId } = await params;
  const token = await getAccessToken();
  if (!token) return { title: "Channel" };
  try {
    const { value } = await getChannelCatalogue(channelId, token);
    return { title: value.channel?.title ?? "Channel" };
  } catch {
    return { title: "Channel" };
  }
}

export default async function ChannelPage({ params, searchParams }: Params) {
  const { channelId } = await params;
  const sort = parseSort((await searchParams).sort);
  const token = await getAccessToken();
  if (!token) redirect("/signin");

  let result;
  try {
    result = await getChannelCatalogue(channelId, token);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof YouTubeQuotaError) {
      return (
        <div className="py-16">
          <Notice title="YouTube's daily quota is used up">
            This channel hasn&apos;t been cached yet. It will load after the quota resets.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  const { channel, videos } = result.value;
  if (!channel && videos.length === 0) notFound();

  const sorted = sortVideos(videos, sort);
  const subs = compactNumber(channel?.subscriberCount);
  const total = compactNumber(channel?.videoCount);
  const capped = channel?.videoCount !== undefined && channel.videoCount > videos.length;

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
            Showing the {videos.length} most recent uploads — the cap that keeps one channel
            page from eating the daily API quota (CHANNEL_CATALOGUE_MAX, currently{" "}
            {config.CHANNEL_CATALOGUE_MAX}).
          </p>
        )}
      </div>

      {sorted.length === 0 ? (
        <Notice title="No public uploads">
          This channel has nothing readable through the API.
        </Notice>
      ) : (
        // Date headings only make sense when the list is in date order.
        <VideoList videos={sorted} showChannel={false} grouped={sort === "newest"} />
      )}
    </div>
  );
}
