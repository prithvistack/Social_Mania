import type { Video } from "@/lib/types";
import { VideoCard } from "./VideoCard";

export function RelatedPanel({
  videos,
  watchLater,
}: {
  videos: Video[];
  watchLater?: Set<string>;
}) {
  return (
    <aside className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
          Related
        </h2>
        <p className="text-[12px] leading-relaxed text-faint">
          Only from channels you subscribe to.
        </p>
      </div>

      {videos.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-muted">
          Nothing in your feed looks close to this one.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {videos.map((video) => (
            <VideoCard key={video.id} video={video} compact savedForLater={watchLater?.has(video.id)} />
          ))}
        </div>
      )}
    </aside>
  );
}
