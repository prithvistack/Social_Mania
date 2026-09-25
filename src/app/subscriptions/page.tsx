import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getAccessToken } from "@/lib/auth";
import { getFeed } from "@/lib/feed";
import { YouTubeAuthError, YouTubeQuotaError } from "@/lib/youtube";
import { Notice } from "@/components/Notice";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Channels" };

export default async function SubscriptionsPage() {
  const token = await getAccessToken();
  if (!token) redirect("/signin");

  let result;
  try {
    result = await getFeed(token);
  } catch (err) {
    if (err instanceof YouTubeAuthError) redirect("/signin?error=RefreshFailed");
    if (err instanceof YouTubeQuotaError) {
      return (
        <div className="py-16">
          <Notice title="YouTube's daily quota is used up">
            Your channel list will be back after the quota resets.
          </Notice>
        </div>
      );
    }
    throw err;
  }

  const feed = result.value;
  const latestByChannel = new Map<string, string>();
  for (const video of feed.videos) {
    if (!latestByChannel.has(video.channelId)) {
      latestByChannel.set(video.channelId, video.publishedAt);
    }
  }

  return (
    <div className="py-10 sm:py-14">
      <div className="mb-10 flex flex-col gap-2">
        <h1 className="text-[22px] font-medium tracking-tight">Channels</h1>
        <p className="text-[12px] text-faint tabular-nums">
          {feed.subscriptions.length} subscriptions
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
        {feed.subscriptions.map((sub) => {
          const latest = latestByChannel.get(sub.channelId);
          return (
            <li key={sub.channelId}>
              <Link
                href={`/channel/${sub.channelId}`}
                className="group flex items-center gap-3.5 rounded-[var(--radius-card)] px-2 py-2.5 transition-colors hover:bg-surface"
              >
                {sub.thumbnail ? (
                  <Image
                    src={sub.thumbnail}
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 shrink-0 rounded-full bg-raised"
                  />
                ) : (
                  <span className="h-9 w-9 shrink-0 rounded-full bg-raised" />
                )}
                <span className="min-w-0 flex-1 truncate text-[14px] transition-colors group-hover:text-accent">
                  {sub.title}
                </span>
                {latest && (
                  <span className="shrink-0 text-[11.5px] text-faint">{timeAgo(latest)}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
