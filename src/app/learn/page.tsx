import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getContext, isDbConfigured, isSchemaReady } from "@/lib/context";
import { isAssistantConfigured } from "@/lib/assistant";
import { LEARNING_CHANNELS } from "@/config/learning-channels";
import { PageHeading } from "@/components/PageHeading";
import { SetupNotice } from "@/components/SetupNotice";
import { AssistantChat } from "@/components/AssistantChat";
import { ActiveCourses } from "@/components/ActiveCourses";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Learn" };

export default async function LearnPage() {
  if (!isDbConfigured() || !(await isSchemaReady())) return <SetupNotice />;
  const ctx = await getContext();
  if (!ctx) redirect("/signin");

  const completed = await ctx.history.completedVideoIds();
  const courses = await ctx.courses.summaries(completed);

  return (
    <div className="py-10 sm:py-14">
      <PageHeading
        title="Learn"
        meta={
          <span>
            Recommends only from real playlists on {LEARNING_CHANNELS.length} curated
            channels
          </span>
        }
      />

      <ActiveCourses courses={courses} />

      <AssistantChat enabled={isAssistantConfigured()} />

      <details className="mt-16 group">
        <summary className="cursor-pointer list-none text-[11.5px] uppercase tracking-[0.14em] text-faint transition-colors hover:text-muted">
          Allowlisted channels
          <span className="ml-2 inline-block transition-transform group-open:rotate-90">›</span>
        </summary>
        <p className="mt-3 text-[12.5px] leading-relaxed text-muted">
          Edit <code className="text-ink">src/config/learning-channels.ts</code> to change
          this list. The assistant is handed these channels&apos; real playlists and can
          only pick from them — anything it invents is discarded before you see it.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {LEARNING_CHANNELS.map((channel) => (
            <li
              key={channel.name}
              className="rounded-full border border-line px-3 py-1 text-[12px] text-muted"
            >
              {channel.name}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
