import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { isAssistantConfigured, DEFAULT_MODEL } from "@/lib/assistant";
import { FEED_TTL_SECONDS } from "@/lib/feed";
import { PageHeading } from "@/components/PageHeading";
import { SetupNotice } from "@/components/SetupNotice";
import { QuotaIndicator } from "@/components/QuotaIndicator";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  const session = await auth();
  const [status, videoCount, channels] = await Promise.all([
    ctx.ledger.status(),
    ctx.videos.count(),
    ctx.videos.subscribedChannels(),
  ]);

  return (
    <div className="py-10 sm:py-14">
      <PageHeading title="Settings" />

      <div className="flex max-w-2xl flex-col gap-12">
        <QuotaIndicator status={status} />

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            Cache
          </h2>
          <Row label="Subscribed channels" value={String(channels.length)} />
          <Row label="Videos cached" value={String(videoCount)} />
          <Row label="Feed refresh interval" value={`${Math.round(FEED_TTL_SECONDS / 60)} min`} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
            Account
          </h2>
          <Row label="Signed in as" value={session?.user?.email ?? "unknown"} />
          <Row
            label="Learning assistant"
            value={isAssistantConfigured() ? (process.env.GEMINI_MODEL || DEFAULT_MODEL) : "not configured"}
          />
        </section>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/60 pb-2.5 text-[13px]">
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}
