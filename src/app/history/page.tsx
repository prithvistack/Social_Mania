import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { PageHeading } from "@/components/PageHeading";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";
import { DeleteEntryButton, HistoryTools } from "@/components/HistoryControls";
import { Thumbnail } from "@/components/VideoCard";
import { dateBucket, exactDate, formatDuration, timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "History" };

export default async function HistoryPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  const rows = await ctx.history.list(300);
  const videos = await ctx.videos.getVideos([...new Set(rows.map((r) => r.video_id))]);
  const byId = new Map(videos.map((v) => [v.id, v]));

  const groups: { label: string; rows: typeof rows }[] = [];
  for (const row of rows) {
    const label = dateBucket(row.watched_at);
    const last = groups.at(-1);
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="History"
        meta={<span className="tabular-nums">{rows.length} entries</span>}
      />

      <div className="mb-10">
        <HistoryTools />
      </div>

      {rows.length === 0 ? (
        <Notice title="Nothing watched yet">
          Watch something and it will show up here. History is recorded only on this site.
        </Notice>
      ) : (
        <div className="flex flex-col gap-10">
          {groups.map((group) => (
            <section key={group.label} className="flex flex-col gap-4">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                {group.label}
              </h2>
              {group.rows.map((row) => {
                const video = byId.get(row.video_id);
                return (
                  <div key={row.id} className="group flex items-center gap-4">
                    {video ? (
                      <Link href={`/watch/${video.id}`} className="relative aspect-video w-[120px] shrink-0">
                        <Thumbnail video={video} className="h-full w-full" sizes="120px" />
                      </Link>
                    ) : (
                      <span className="aspect-video w-[120px] shrink-0 rounded-[var(--radius-card)] bg-raised" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">
                        {video ? (
                          <Link href={`/watch/${video.id}`} className="transition-colors hover:text-accent">
                            {video.title}
                          </Link>
                        ) : (
                          <span className="text-muted">{row.video_id} (not cached)</span>
                        )}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                        {video && <span className="truncate">{video.channelTitle}</span>}
                        {video && <span className="text-faint">·</span>}
                        <time dateTime={row.watched_at} title={exactDate(row.watched_at)}>
                          {timeAgo(row.watched_at)}
                        </time>
                        <span className="text-faint">·</span>
                        <span className="tabular-nums">
                          {formatDuration(row.seconds_watched) ?? "0:00"} watched
                        </span>
                        {row.completed && (
                          <>
                            <span className="text-faint">·</span>
                            <span className="text-accent">finished</span>
                          </>
                        )}
                      </p>
                    </div>

                    <DeleteEntryButton id={row.id} />
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
