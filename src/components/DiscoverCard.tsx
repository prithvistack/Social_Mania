"use client";

import Image from "next/image";
import Link from "next/link";
import { useTransition } from "react";
import { dismissSuggestionAction } from "@/app/actions";
import type { DiscoveredChannelRow } from "@/lib/db/types";

export function DiscoverCard({ suggestion }: { suggestion: DiscoveredChannelRow }) {
  const [pending, start] = useTransition();
  const watched = suggestion.evidence.filter((e) => e.watched);

  return (
    <article
      className={`flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-4 transition-opacity ${pending ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-3.5">
        {suggestion.thumbnail ? (
          <Image
            src={suggestion.thumbnail}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 rounded-full bg-raised"
          />
        ) : (
          <span className="h-10 w-10 shrink-0 rounded-full bg-raised" />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-medium">
            <Link
              href={`/channel/${suggestion.channel_id}`}
              className="transition-colors hover:text-accent"
            >
              {suggestion.title}
            </Link>
          </h3>
          {suggestion.handle && (
            <p className="truncate text-[12px] text-faint">@{suggestion.handle}</p>
          )}
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => dismissSuggestionAction(suggestion.channel_id))}
          aria-label={`Dismiss ${suggestion.title}`}
          title="Not interested"
          className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-[12.5px] leading-relaxed text-muted">{suggestion.reason}</p>

      {suggestion.evidence.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none text-[11.5px] text-faint transition-colors hover:text-muted">
            Evidence
            <span className="ml-1.5 inline-block transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {suggestion.evidence.slice(0, 5).map((item) => (
              <li key={item.video_id} className="text-[12px] leading-snug text-faint">
                <Link href={`/watch/${item.video_id}`} className="transition-colors hover:text-ink">
                  {item.video_title}
                </Link>
                <span className="ml-1.5">
                  — {item.channel_title}
                  {item.watched ? " · watched" : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {watched.length > 0 && (
        <p className="text-[11px] text-faint tabular-nums">
          Weighted up: {watched.length} of these you actually watched.
        </p>
      )}
    </article>
  );
}
