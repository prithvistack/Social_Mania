import Image from "next/image";
import Link from "next/link";
import type { Video } from "@/lib/types";
import { compactNumber, exactDate, formatDuration, timeAgo } from "@/lib/format";

export function Thumbnail({
  video,
  className = "",
  sizes = "(max-width: 640px) 100vw, 224px",
}: {
  video: Video;
  className?: string;
  sizes?: string;
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
    </div>
  );
}

type Props = {
  video: Video;
  /** Hidden on a channel page, where every row is the same channel. */
  showChannel?: boolean;
  compact?: boolean;
};

export function VideoCard({ video, showChannel = true, compact = false }: Props) {
  const views = compactNumber(video.viewCount);
  const likes = compactNumber(video.likeCount);

  return (
    <article className="group animate-rise">
      <div className={`flex gap-4 ${compact ? "sm:gap-3" : "sm:gap-5"}`}>
        <Link
          href={`/watch/${video.id}`}
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
          />
        </Link>

        <div className="flex min-w-0 flex-col justify-start gap-1.5 py-0.5">
          <h3
            className={
              compact
                ? "text-[13.5px] font-medium leading-snug"
                : "text-[15px] font-medium leading-snug sm:text-base"
            }
          >
            <Link
              href={`/watch/${video.id}`}
              className="line-clamp-2-safe decoration-faint underline-offset-4 transition-colors hover:text-accent"
            >
              {video.title}
            </Link>
          </h3>

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
          </div>
        </div>
      </div>
    </article>
  );
}

function Dot() {
  return <span className="text-faint">·</span>;
}
