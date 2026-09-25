"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

type Result = {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
};

/**
 * The paid half of search. It never runs on render or on typing — only when
 * this button is pressed — and the price is printed on the button itself.
 */
export function YouTubeSearchPanel({ query, cost }: { query: string; cost: number }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [results, setResults] = useState<Result[]>([]);
  const [message, setMessage] = useState("");

  async function run() {
    setState("loading");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: query }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "Search failed.");
        setState("error");
        return;
      }
      setResults(body.results ?? []);
      setMessage(
        body.cached
          ? "Served from the 24-hour cache — cost 0 units."
          : `Spent ${body.unitsSpent} units.`,
      );
      setState("done");
    } catch (err) {
      setMessage((err as Error).message);
      setState("error");
    }
  }

  if (!query) return null;

  return (
    <section className="mt-12 flex flex-col gap-4 border-t border-line pt-8">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={run}
          disabled={state === "loading"}
          className="rounded-md border border-line px-3.5 py-2 text-[13px] transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {state === "loading" ? "Searching YouTube…" : "Search all of YouTube"}
        </button>
        <span className="text-[12px] text-faint tabular-nums">
          costs {cost} quota units
        </span>
      </div>

      {message && <p className="text-[12px] text-faint">{message}</p>}

      {state === "done" && results.length === 0 && (
        <p className="text-[13px] text-muted">No results.</p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-5">
          {results.map((result) => (
            <article key={result.videoId} className="group flex gap-4">
              <Link
                href={`/watch/${result.videoId}`}
                className="relative aspect-video w-[160px] shrink-0 overflow-hidden rounded-[var(--radius-card)] bg-raised"
              >
                {result.thumbnail && (
                  <Image src={result.thumbnail} alt="" fill sizes="160px" className="object-cover" />
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <h3 className="text-[14px] font-medium leading-snug">
                  <Link
                    href={`/watch/${result.videoId}`}
                    className="line-clamp-2-safe transition-colors hover:text-accent"
                  >
                    {result.title}
                  </Link>
                </h3>
                <p className="mt-1 truncate text-[12px] text-muted">
                  <Link href={`/channel/${result.channelId}`} className="hover:text-ink">
                    {result.channelTitle}
                  </Link>
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
