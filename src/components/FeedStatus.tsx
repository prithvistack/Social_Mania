import { timeAgo } from "@/lib/format";

export function FeedStatus({
  storedAt,
  channels,
  videos,
  stale,
  failedChannels = [],
}: {
  storedAt: number;
  channels: number;
  videos: number;
  stale?: boolean;
  failedChannels?: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-faint">
      <span>
        {stale ? "Showing cached feed from " : "Updated "}
        {timeAgo(new Date(storedAt).toISOString())}
      </span>
      <span>·</span>
      <span className="tabular-nums">{channels} channels</span>
      <span>·</span>
      <span className="tabular-nums">{videos} videos</span>
      {failedChannels.length > 0 && (
        <>
          <span>·</span>
          <span title={failedChannels.join(", ")}>
            {failedChannels.length} unavailable
          </span>
        </>
      )}
    </div>
  );
}
