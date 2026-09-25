import Link from "next/link";
import type { CourseSummary } from "@/lib/db/courses";

/**
 * Course progress on the home page. Plain counts, no streaks or badges —
 * "7/19 lectures" and a way back in.
 */
export function ActiveCourses({ courses }: { courses: CourseSummary[] }) {
  if (courses.length === 0) return null;

  return (
    <section className="mb-12 flex flex-col gap-4">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
        In progress
      </h2>
      <div className="flex flex-col gap-2.5">
        {courses.map((course) => {
          const pct = course.total > 0 ? (course.completed / course.total) * 100 : 0;
          return (
            <div
              key={course.playlist.playlist_id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{course.playlist.title}</p>
                <p className="mt-1 text-[12px] text-muted tabular-nums">
                  {course.playlist.channel_title} · {course.completed}/{course.total} lectures
                </p>
                <span className="mt-2 block h-[3px] w-full max-w-xs overflow-hidden rounded-full bg-raised">
                  <span className="block h-full bg-accent" style={{ width: `${pct}%` }} />
                </span>
              </div>
              {course.nextVideoId ? (
                <Link
                  href={`/watch/${course.nextVideoId}`}
                  className="shrink-0 rounded-md border border-line px-3 py-1.5 text-[12.5px] transition-colors hover:border-accent hover:text-accent"
                  title={course.nextTitle ?? undefined}
                >
                  Continue
                </Link>
              ) : (
                <span className="shrink-0 text-[12px] text-accent">Finished</span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
