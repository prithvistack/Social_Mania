import { redirect } from "next/navigation";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { getFeedPage } from "@/lib/feed";
import { YouTubeAuthError } from "@/lib/youtube";
import { QuotaBudgetError } from "@/lib/quota";
import { VideoList } from "@/components/VideoList";
import { ActiveCourses } from "@/components/ActiveCourses";
import { PageHeading } from "@/components/PageHeading";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FeedPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;

  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  let page;
  try {
    page = await getFeedPage(ctx);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof QuotaBudgetError) {
      return (
        <div className="py-16">
          <Notice title="Today's API budget is spent">
            The feed will refresh again after the quota resets at midnight Pacific.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  if (page.channels === 0) {
    return (
      <div className="py-16">
        <Notice title="No subscriptions found">
          This Google account doesn&apos;t follow any channels yet, or its subscriptions are
          private. Subscribe to a few channels on YouTube and hit Refresh.
        </Notice>
      </div>
    );
  }

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="Latest"
        meta={
          <>
            <span>
              {page.lastSyncedAt ? `Updated ${timeAgo(page.lastSyncedAt)}` : "Not synced yet"}
            </span>
            <span>·</span>
            <span className="tabular-nums">{page.channels} channels</span>
            <span>·</span>
            <span className="tabular-nums">{page.videos.length} videos</span>
          </>
        }
      />

      <ActiveCourses courses={page.courses} />

      {page.videos.length === 0 ? (
        <Notice title="Nothing cached yet">
          Hit Refresh to pull your channels&apos; uploads. The first sync takes a moment.
        </Notice>
      ) : (
        <VideoList
          videos={page.videos}
          watchLater={page.watchLater}
          positions={page.positions}
        />
      )}
    </div>
  );
}
