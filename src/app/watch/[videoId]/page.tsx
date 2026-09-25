import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAccessToken } from "@/lib/auth";
import { getRelatedPool, getVideo } from "@/lib/feed";
import { findRelated } from "@/lib/related";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";
import { Player } from "@/components/Player";
import { RelatedPanel } from "@/components/RelatedPanel";
import { Notice } from "@/components/Notice";
import { compactNumber, exactDate, timeAgo } from "@/lib/format";
import type { Video } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ videoId: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { videoId } = await params;
  const token = await getAccessToken();
  if (!token) return { title: "Watch" };
  try {
    const video = await getVideo(videoId, token);
    return { title: video?.title ?? "Watch" };
  } catch {
    return { title: "Watch" };
  }
}

export default async function WatchPage({ params }: Params) {
  const { videoId } = await params;
  const token = await getAccessToken();
  if (!token) redirect("/signin");

  let video;
  try {
    video = await getVideo(videoId, token);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof YouTubeQuotaError) {
      return (
        <div className="py-16">
          <Notice title="YouTube's daily quota is used up">
            This video isn&apos;t in the cache and can&apos;t be fetched until the quota resets.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  if (!video) notFound();

  // Related candidates come from the cached feed, so by construction they can
  // only be uploads from channels that are already subscribed to.
  let related: Video[] = [];
  try {
    related = findRelated(video, await getRelatedPool(token), { limit: 12 });
  } catch {
    // A related-videos failure should never block playback.
  }

  const views = compactNumber(video.viewCount);
  const likes = compactNumber(video.likeCount);

  return (
    <div className="grid grid-cols-1 gap-12 py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10 xl:gap-14">
      <div className="flex min-w-0 flex-col gap-6">
        <Player videoId={video.id} title={video.title} embeddable={video.embeddable} />

        <div className="flex flex-col gap-3">
          <h1 className="text-[19px] font-medium leading-snug tracking-tight sm:text-[21px]">
            {video.title}
          </h1>

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
            <a
              href={`https://www.youtube.com/watch?v=${video.id}`}
              target="_blank"
              rel="noreferrer noopener"
              className="ml-auto text-[12px] text-faint transition-colors hover:text-ink"
            >
              Open on YouTube ↗
            </a>
          </div>
        </div>

        {video.description.trim() && (
          <details className="group rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5">
            <summary className="cursor-pointer list-none text-[12px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-muted">
              Description
              <span className="ml-2 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-muted">
              {video.description}
            </p>
          </details>
        )}
      </div>

      <RelatedPanel videos={related} />
    </div>
  );
}
