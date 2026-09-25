import type { Video } from "@/lib/types";
import { dateBucket } from "@/lib/format";
import { VideoCard } from "./VideoCard";

/**
 * Groups the feed under date headings. Scanning "Today / Yesterday / This week"
 * reads much more like an inbox than an unbroken wall of rows.
 */
export function VideoList({
  videos,
  showChannel = true,
  grouped = true,
  watchLater,
  positions,
}: {
  videos: Video[];
  showChannel?: boolean;
  grouped?: boolean;
  watchLater?: Set<string>;
  positions?: Map<string, number>;
}) {
  const card = (video: Video) => (
    <VideoCard
      key={video.id}
      video={video}
      showChannel={showChannel}
      savedForLater={watchLater?.has(video.id) ?? false}
      resumeAt={positions?.get(video.id)}
    />
  );

  if (!grouped) {
    return (
      <div className="flex flex-col gap-7">{videos.map(card)}</div>
    );
  }

  const groups: { label: string; videos: Video[] }[] = [];
  for (const video of videos) {
    const label = dateBucket(video.publishedAt);
    const last = groups.at(-1);
    if (last?.label === label) last.videos.push(video);
    else groups.push({ label, videos: [video] });
  }

  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.label} className="flex flex-col gap-7">
          <h2 className="sticky top-14 z-10 -mx-2 bg-canvas/90 px-2 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-faint backdrop-blur-sm">
            {group.label}
          </h2>
          {group.videos.map(card)}
        </section>
      ))}
    </div>
  );
}
