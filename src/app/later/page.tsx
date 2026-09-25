import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { PageHeading } from "@/components/PageHeading";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { VideoList } from "@/components/VideoList";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Watch Later" };

export default async function LaterPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  // Everything here is already cached, so the queue costs no quota at all.
  const queue = await ctx.watchLater.list();
  const videos = await ctx.videos.getVideos(queue.map((q) => q.video_id));
  const order = new Map(queue.map((q, i) => [q.video_id, i]));
  videos.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const positions = await ctx.history.getPositions(videos.map((v) => v.id));
  const saved = new Set(videos.map((v) => v.id));

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="Watch Later"
        meta={<span className="tabular-nums">{videos.length} queued</span>}
      />
      {videos.length === 0 ? (
        <Notice title="Queue is empty">
          Use the bookmark icon on any video to put it here.
        </Notice>
      ) : (
        <VideoList videos={videos} grouped={false} watchLater={saved} positions={positions} />
      )}
    </div>
  );
}
