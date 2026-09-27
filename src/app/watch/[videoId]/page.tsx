import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { getWatchData } from "@/lib/feed";
import { findRelated } from "@/lib/related";
import { YouTubeAuthError } from "@/lib/youtube";
import { QuotaBudgetError } from "@/lib/quota";
import { Player } from "@/components/Player";
import { RelatedPanel } from "@/components/RelatedPanel";
import { WatchLaterButton } from "@/components/WatchLaterButton";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { compactNumber, exactDate, formatDuration, timeAgo } from "@/lib/format";
import type { Video } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ videoId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { videoId } = await params;
  if (!isDbConfigured()) return { title: "Watch" };
  const ctx = await getContext();
  if (!ctx) return { title: "Watch" };
  try {
    const video = await ctx.videos.getVideo(videoId);
    return { title: video?.title ?? "Watch" };
  } catch {
    return { title: "Watch" };
  }
}

export default async function WatchPage({ params }: Params) {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const { videoId } = await params;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  let data;
  try {
    data = await getWatchData(ctx, videoId);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof QuotaBudgetError) {
      return (
        <div className="py-16">
          <Notice title="Today's API budget is spent">
            This video isn&apos;t cached and can&apos;t be fetched until the quota resets.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  if (!data) notFound();
  const { video, pool, position, watchLater } = data;

  let related: Video[] = [];
  try {
    related = findRelated(video, pool, { limit: 12 });
  } catch {
    // A related-videos failure must never block playback.
  }

  const views = compactNumber(video.viewCount);
  const likes = compactNumber(video.likeCount);
  const resumeAt = position?.position_seconds ?? 0;

  return (
    // Three named areas so theatre mode can rearrange them with CSS alone —
    // the player element never moves in the DOM, so playback never restarts.
    <div className="watch-layout py-8">
      <div className="watch-player">
        <Player
          videoId={video.id}
          channelId={video.channelId}
          title={video.title}
          embeddable={video.embeddable}
          startAt={resumeAt}
        />
      </div>

      <div className="watch-info flex min-w-0 flex-col gap-6">

        <div className="flex flex-col gap-3">
          <h1 className="text-[19px] font-medium leading-snug tracking-tight sm:text-[21px]">
            {video.title}
          </h1>

          {resumeAt > 5 && (
            <p className="text-[12px] text-accent">
              Resuming from {formatDuration(resumeAt)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted">
            <Link
              href={`/channel/${video.channelId}`}
              className="font-medium text-ink transition-colors hover:text-accent"
            >
              {video.channelTitle}
            </Link>
            <span className="text-faint">·</span>
            <time dateTime={video.publishedAt} title={exactDate(video.publishedAt)}>
              {timeAgo(video.publishedAt)}
            </time>
            {views && (
              <>
                <span className="text-faint">·</span>
                <span className="tabular-nums">{views} views</span>
              </>
            )}
            {likes && (
              <>
                <span className="text-faint">·</span>
                <span className="tabular-nums">{likes} likes</span>
              </>
            )}
            <span className="ml-auto flex items-center gap-2">
              <WatchLaterButton videoId={video.id} saved={watchLater.has(video.id)} label />
              <a
                href={`https://www.youtube.com/watch?v=${video.id}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-[12px] text-faint transition-colors hover:text-ink"
              >
                Open on YouTube ↗
              </a>
            </span>
          </div>
        </div>

        {video.description.trim() && (
          <details className="group rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5">
            <summary className="cursor-pointer list-none text-[12px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-muted">
              Description
              <span className="ml-2 inline-block transition-transform group-open:rotate-90">›</span>
            </summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-muted">
              {video.description}
            </p>
          </details>
        )}
      </div>

      <div className="watch-related">
        <RelatedPanel videos={related} watchLater={watchLater} />
      </div>
    </div>
  );
}
