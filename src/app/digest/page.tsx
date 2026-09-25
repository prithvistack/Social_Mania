import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { buildDigest } from "@/lib/digest";
import { PageHeading } from "@/components/PageHeading";
import { Notice } from "@/components/Notice";
import { SetupNotice } from "@/components/SetupNotice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Digest" };

function hours(seconds: number): string {
  if (seconds < 60) return "under a minute";
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export default async function DigestPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  const digest = await buildDigest(ctx);
  const delta = digest.totalSeconds - digest.previousSeconds;

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="This week"
        meta={<span>Computed from your own history. Nothing leaves this app.</span>}
      />

      {digest.videoCount === 0 ? (
        <Notice title="Nothing watched in the last seven days">
          There is no week to summarise yet.
        </Notice>
      ) : (
        <div className="flex flex-col gap-14">
          <section className="flex flex-wrap gap-x-14 gap-y-6">
            <Stat label="Watched" value={hours(digest.totalSeconds)} />
            <Stat label="Videos" value={String(digest.videoCount)} />
            <Stat
              label="vs last week"
              value={
                digest.previousSeconds === 0
                  ? "—"
                  : `${delta >= 0 ? "+" : "−"}${hours(Math.abs(delta))}`
              }
            />
          </section>

          {digest.categories.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                By category
              </h2>
              <div className="flex flex-col gap-2.5">
                {digest.categories.slice(0, 8).map((row) => (
                  <div key={row.category} className="flex items-center gap-4">
                    <span className="w-28 shrink-0 truncate text-[13px]">{row.category}</span>
                    <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-raised">
                      <span
                        className="block h-full bg-accent"
                        style={{ width: `${Math.max(2, row.share * 100)}%` }}
                      />
                    </span>
                    <span className="w-20 shrink-0 text-right text-[12px] text-muted tabular-nums">
                      {hours(row.seconds)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {digest.channels.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                Top channels
              </h2>
              <div className="flex flex-col gap-2">
                {digest.channels.map((channel) => (
                  <div
                    key={channel.channelId}
                    className="flex items-baseline justify-between gap-4 text-[13px]"
                  >
                    <span className="truncate">{channel.title}</span>
                    <span className="shrink-0 text-[12px] text-muted tabular-nums">
                      {hours(channel.seconds)} · {channel.videos}{" "}
                      {channel.videos === 1 ? "video" : "videos"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {digest.courses.length > 0 && (
            <section className="flex flex-col gap-4">
              <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                Courses
              </h2>
              <div className="flex flex-col gap-2">
                {digest.courses.map((course) => (
                  <div
                    key={course.title}
                    className="flex items-baseline justify-between gap-4 text-[13px]"
                  >
                    <span className="truncate">{course.title}</span>
                    <span className="shrink-0 text-[12px] text-muted tabular-nums">
                      {course.completed}/{course.total}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-[0.14em] text-faint">{label}</span>
      <span className="text-[24px] font-medium tracking-tight tabular-nums">{value}</span>
    </div>
  );
}
