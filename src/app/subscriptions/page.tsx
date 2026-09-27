import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { PageHeading } from "@/components/PageHeading";
import { SetupNotice } from "@/components/SetupNotice";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Channels" };

export default async function SubscriptionsPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  // Both in parallel, and only two columns for the dates — this page used
  // to download the whole feed, descriptions included, to find them.
  const [channels, latest] = await Promise.all([
    ctx.videos.subscribedChannels(),
    ctx.videos.latestUploadByChannel(),
  ]);

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="Channels"
        meta={<span className="tabular-nums">{channels.length} subscriptions</span>}
      />

      <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {channels.map((channel) => {
          const last = latest.get(channel.channel_id);
          return (
            <li key={channel.channel_id}>
              <Link
                href={`/channel/${channel.channel_id}`}
                className="group flex items-center gap-3.5 rounded-[var(--radius-card)] px-2 py-2.5 transition-colors hover:bg-surface"
              >
                {channel.thumbnail ? (
                  <Image
                    src={channel.thumbnail}
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 shrink-0 rounded-full bg-raised"
                  />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-full bg-raised" />
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] transition-colors group-hover:text-accent">
                  {channel.title}
                </span>
                {last && (
                  <span className="shrink-0 text-[11.5px] text-faint">{timeAgo(last)}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
