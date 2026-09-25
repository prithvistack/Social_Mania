"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { startCourseAction } from "@/app/actions";

type Recommendation = {
  playlistId: string;
  title: string;
  channelTitle: string;
  thumbnail: string;
  itemCount: number;
  why: string;
};

type Turn = {
  role: "user" | "assistant";
  content: string;
  recommendations?: Recommendation[];
  note?: string;
};

const SUGGESTIONS = [
  "I want to learn NLP",
  "Teach me linear algebra from scratch",
  "Something on how transformers actually work",
];

export function AssistantChat({ enabled }: { enabled: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setError("");
    setBusy(true);
    setInput("");

    const history = turns.map((t) => ({ role: t.role, content: t.content }));
    setTurns((prev) => [...prev, { role: "user", content: question }]);

    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "The assistant failed.");
        return;
      }
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: body.reply,
          recommendations: body.recommendations,
          note:
            body.rejected?.length > 0
              ? `${body.rejected.length} suggested course${body.rejected.length === 1 ? "" : "s"} weren't in the fetched catalogue and were dropped.`
              : undefined,
        },
      ]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  if (!enabled) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4">
        <p className="text-[13.5px] font-medium">The assistant isn&apos;t configured</p>
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted">
          Set <code className="text-ink">GEMINI_API_KEY</code> in{" "}
          <code className="text-ink">.env.local</code> to enable it. The key is only ever
          read on the server.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {turns.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => ask(suggestion)}
              className="rounded-full border border-line px-3.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {turns.map((turn, i) => (
        <div key={i} className="flex flex-col gap-4">
          {turn.role === "user" ? (
            <p className="text-[14px] font-medium">{turn.content}</p>
          ) : (
            <>
              <p className="text-[14px] leading-relaxed text-muted">{turn.content}</p>
              {turn.recommendations && turn.recommendations.length > 0 && (
                <div className="flex flex-col gap-3">
                  {turn.recommendations.map((course) => (
                    <CourseCard key={course.playlistId} course={course} />
                  ))}
                </div>
              )}
              {turn.note && <p className="text-[11.5px] text-faint">{turn.note}</p>}
            </>
          )}
        </div>
      ))}

      {busy && <p className="text-[13px] text-faint">Reading course catalogues…</p>}
      {error && (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-[13px] text-muted">
          {error}
        </p>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
        className="sticky bottom-6 flex gap-2"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="What do you want to learn?"
          disabled={busy}
          className="min-w-0 flex-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 text-[14px] text-ink placeholder:text-faint disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-[var(--radius-card)] border border-line px-4 py-2.5 text-[13px] transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  );
}

function CourseCard({ course }: { course: Recommendation }) {
  const [pending, start] = useTransition();
  const [started, setStarted] = useState(false);

  return (
    <article className="flex gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4">
      {course.thumbnail && (
        <div className="relative aspect-video w-[120px] shrink-0 overflow-hidden rounded-md bg-raised">
          <Image src={course.thumbnail} alt="" fill sizes="120px" className="object-cover" />
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="text-[14px] font-medium leading-snug">{course.title}</h3>
        <p className="text-[12px] text-faint tabular-nums">
          {course.channelTitle} · {course.itemCount} videos
        </p>
        <p className="text-[12.5px] leading-relaxed text-muted">{course.why}</p>
        <div className="mt-1.5 flex items-center gap-3">
          <button
            type="button"
            disabled={pending || started}
            onClick={() =>
              start(async () => {
                await startCourseAction(course.playlistId, course.why);
                setStarted(true);
              })
            }
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
          >
            {started ? "Tracking progress" : pending ? "Starting…" : "Start course"}
          </button>
          <a
            href={`https://www.youtube.com/playlist?list=${course.playlistId}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11.5px] text-faint transition-colors hover:text-ink"
          >
            View playlist ↗
          </a>
        </div>
      </div>
    </article>
  );
}
