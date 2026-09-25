"use client";

import { useOptimistic, useTransition } from "react";
import { toggleWatchLaterAction } from "@/app/actions";

export function WatchLaterButton({
  videoId,
  saved,
  label = false,
}: {
  videoId: string;
  saved: boolean;
  label?: boolean;
}) {
  const [optimistic, setOptimistic] = useOptimistic(saved);
  const [, start] = useTransition();

  return (
    <button
      type="button"
      aria-pressed={optimistic}
      title={optimistic ? "Remove from Watch Later" : "Save to Watch Later"}
      onClick={(event) => {
        event.preventDefault();
        start(async () => {
          setOptimistic(!optimistic);
          await toggleWatchLaterAction(videoId);
        });
      }}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors ${
        optimistic ? "text-accent" : "text-faint hover:text-ink"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill={optimistic ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
      {label && <span>{optimistic ? "Saved" : "Watch later"}</span>}
    </button>
  );
}
