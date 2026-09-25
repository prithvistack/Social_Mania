import Image from "next/image";
import Link from "next/link";
import type { Video } from "@/lib/types";
import { compactNumber, exactDate, formatDuration, timeAgo } from "@/lib/format";
import { WatchLaterButton } from "./WatchLaterButton";

export function Thumbnail({
  video,
  className = "",
  sizes = "(max-width: 640px) 100vw, 224px",
  progress,
}: {
  video: Video;
  className?: string;
  sizes?: string;
  /** 0-1, drawn as a thin resume bar along the bottom. */
  progress?: number;
}) {
  const duration = formatDuration(video.durationSeconds);
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-raised ${className}`}
    >
      {video.thumbnail ? (
        <Image
          src={video.thumbnail}
          alt=""
          fill
          sizes={sizes}
          className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
        />
      ) : null}
      {duration && (
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white">
          {duration}
        </span>
      )}
      {progress !== undefined && progress > 0.01 && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/40">
          <span
            className="block h-full bg-accent"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </span>
      )}
    </div>
  );
}

type Props = {
  video: Video;
  showChannel?: boolean;
  compact?: boolean;
  /** Resume point in seconds, if any. */
  resumeAt?: number;
  savedForLater?: boolean;
  showSave?: boolean;
};

export function VideoCard({
  video,
  showChannel = true,
  compact = false,
  resumeAt,
  savedForLater = false,
  showSave = true,
}: Props) {
  const views = compactNumber(video.viewCount);
  const likes = compactNumber(video.likeCount);
  const progress =
    resumeAt && video.durationSeconds ? resumeAt / video.durationSeconds : undefined;
  const href = `/watch/${video.id}`;

  return (
    <article className="group animate-rise">
      <div className={`flex gap-4 ${compact ? "sm:gap-3" : "sm:gap-5"}`}>
        <Link
          href={href}
          tabIndex={-1}
          aria-hidden
          className={
            compact
              ? "relative aspect-video w-[40%] max-w-[168px] shrink-0"
              : "relative aspect-video w-[42%] max-w-[240px] shrink-0"
          }
        >
          <Thumbnail
            video={video}
            className="h-full w-full"
            sizes={compact ? "168px" : "(max-width: 640px) 45vw, 240px"}
            progress={progress}
          />
        </Link>

        <div className="flex min-w-0 flex-1 flex-col justify-start gap-1.5 py-0.5">
          <div className="flex items-start gap-2">
            <h3
              className={
                compact
                  ? "min-w-0 flex-1 text-[13.5px] font-medium leading-snug"
                  : "min-w-0 flex-1 text-[15px] font-medium leading-snug sm:text-base"
              }
            >
              <Link
                href={href}
                className="line-clamp-2-safe decoration-faint underline-offset-4 transition-colors hover:text-accent"
              >
                {video.title}
              </Link>
            </h3>
            {showSave && !compact && (
              <WatchLaterButton videoId={video.id} saved={savedForLater} />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-muted">
            {showChannel && (
              <>
                <Link
                  href={`/channel/${video.channelId}`}
                  className="truncate transition-colors hover:text-ink"
                >
                  {video.channelTitle}
                </Link>
                <Dot />
              </>
            )}
            <time dateTime={video.publishedAt} title={exactDate(video.publishedAt)}>
              {timeAgo(video.publishedAt)}
            </time>
            {views && (
              <>
                <Dot />
                <span className="tabular-nums">{views} views</span>
              </>
            )}
            {!compact && likes && (
              <>
                <Dot />
                <span className="tabular-nums">{likes} likes</span>
              </>
            )}
            {video.isShort && (
              <span className="rounded border border-line px-1.5 py-px text-[10.5px] uppercase tracking-wide text-faint">
                Short
              </span>
            )}
            {progress !== undefined && progress > 0.01 && (
              <>
                <Dot />
                <span className="text-accent">Resume</span>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Dot() {
  return <span className="text-faint">·</span>;
}
