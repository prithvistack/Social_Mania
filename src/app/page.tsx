import { redirect } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { getFeed } from "@/lib/feed";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";
import { VideoList } from "@/components/VideoList";
import { FeedStatus } from "@/components/FeedStatus";
import { Notice } from "@/components/Notice";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  const token = await getAccessToken();
  if (!token) redirect("/signin");

  let result;
  try {
    result = await getFeed(token);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof YouTubeQuotaError) {
      return (
        <div className="py-16">
          <Notice title="YouTube's daily quota is used up">
            The feed will work again after the quota resets at midnight Pacific time. Raising{" "}
            <code className="text-ink">FEED_TTL_SECONDS</code> or lowering{" "}
            <code className="text-ink">FEED_VIDEOS_PER_CHANNEL</code> will keep this from
            happening again.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  const { value: feed, storedAt, fresh } = result;

  if (feed.subscriptions.length === 0) {
    return (
      <div className="py-16">
        <Notice title="No subscriptions found">
          This Google account doesn&apos;t follow any channels yet, or its subscriptions are
          set to private. Subscribe to a few channels on YouTube and hit Refresh.
        </Notice>
      </div>
    );
  }

  return (
    <div className="py-10 sm:py-14">
      <div className="mb-10 flex flex-col gap-2">
        <h1 className="text-[22px] font-medium tracking-tight">Latest</h1>
        <FeedStatus
          storedAt={storedAt}
          channels={feed.subscriptions.length}
          videos={feed.videos.length}
          stale={!fresh}
          failedChannels={feed.failedChannels}
        />
      </div>

      {feed.videos.length === 0 ? (
        <Notice title="Nothing to show yet">
          None of your channels had readable uploads. Try Refresh in a moment.
        </Notice>
      ) : (
        <VideoList videos={feed.videos} />
      )}
    </div>
  );
}
