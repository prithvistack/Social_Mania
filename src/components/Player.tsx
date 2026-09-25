"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;

function loadIframeApi(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("server"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Could not load the YouTube IFrame API"));
    document.head.appendChild(script);
  });
  return apiPromise;
}

// 101 and 150 both mean "the uploader does not allow this video to be embedded".
const EMBED_BLOCKED = new Set([101, 150]);
/** How often progress is flushed to the server while playing. */
const FLUSH_INTERVAL_MS = 15_000;

export function Player({
  videoId,
  channelId,
  title,
  embeddable = true,
  startAt = 0,
}: {
  videoId: string;
  channelId: string;
  title: string;
  embeddable?: boolean;
  /** Resume point in seconds, from playback_positions. */
  startAt?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [blocked, setBlocked] = useState(!embeddable);
  const [failed, setFailed] = useState(false);

  // Seconds actually spent playing, accumulated from ticks rather than read
  // from currentTime, so scrubbing around doesn't inflate the total.
  const watchedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const sentRef = useRef(0);

  const flush = useCallback(
    (useBeacon: boolean) => {
      const player = playerRef.current;
      if (!player?.getCurrentTime) return;

      let position = 0;
      let duration = 0;
      try {
        position = Math.floor(player.getCurrentTime() ?? 0);
        duration = Math.floor(player.getDuration() ?? 0);
      } catch {
        return;
      }

      const watched = Math.floor(watchedRef.current);
      // Nothing new to say.
      if (watched <= 0 || (watched === sentRef.current && position === 0)) return;
      sentRef.current = watched;

      const payload = JSON.stringify({
        videoId,
        channelId,
        positionSeconds: position,
        secondsWatched: watched,
        durationSeconds: duration,
      });

      // On unload, fetch() is cancelled — sendBeacon is the only reliable path.
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(
          "/api/history/progress",
          new Blob([payload], { type: "application/json" }),
        );
        return;
      }
      void fetch("/api/history/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    },
    [videoId, channelId],
  );

  useEffect(() => {
    if (!embeddable) return;
    let cancelled = false;

    loadIframeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;

        // The API swaps the element it is given for an <iframe>. Handing it a
        // div we create here keeps that swap outside React's tree.
        const mount = document.createElement("div");
        mount.style.width = "100%";
        mount.style.height = "100%";
        hostRef.current.appendChild(mount);

        playerRef.current = new YT.Player(mount, {
          videoId,
          playerVars: {
            // rel=0 keeps end-of-video suggestions within this channel —
            // YouTube no longer allows removing them outright, so playback is
            // also stopped on ENDED, which shows the thumbnail instead.
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            playsinline: 1,
            autoplay: 0,
            start: startAt > 0 ? Math.floor(startAt) : undefined,
            origin: window.location.origin,
          },
          events: {
            onError: (event: { data: number }) => {
              if (EMBED_BLOCKED.has(event.data)) setBlocked(true);
              else setFailed(true);
            },
            onStateChange: (event: { data: number }) => {
              const states = window.YT?.PlayerState;
              if (event.data === states?.PLAYING) {
                lastTickRef.current = Date.now();
              } else {
                if (lastTickRef.current) {
                  watchedRef.current += (Date.now() - lastTickRef.current) / 1000;
                  lastTickRef.current = null;
                }
                if (event.data === states?.ENDED) {
                  flush(false);
                  playerRef.current?.stopVideo?.();
                } else if (event.data === states?.PAUSED) {
                  flush(false);
                }
              }
            },
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));

    const timer = setInterval(() => {
      if (lastTickRef.current) {
        const nowMs = Date.now();
        watchedRef.current += (nowMs - lastTickRef.current) / 1000;
        lastTickRef.current = nowMs;
        flush(false);
      }
    }, FLUSH_INTERVAL_MS);

    // visibilitychange is the reliable unload signal on mobile; pagehide
    // covers the rest. beforeunload alone is not dependable.
    const onHide = () => {
      if (lastTickRef.current) {
        watchedRef.current += (Date.now() - lastTickRef.current) / 1000;
        lastTickRef.current = null;
      }
      flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      onHide();
      try {
        playerRef.current?.destroy?.();
      } catch {
        // The iframe may already be gone during a fast route change.
      }
      playerRef.current = null;
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [videoId, embeddable, startAt, flush]);

  if (blocked || failed) {
    return <Fallback videoId={videoId} title={title} blocked={blocked} startAt={startAt} />;
  }

  return (
    <div className="player-frame relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black">
      <div ref={hostRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

function Fallback({
  videoId,
  title,
  blocked,
  startAt,
}: {
  videoId: string;
  title: string;
  blocked: boolean;
  startAt: number;
}) {
  const href = `https://www.youtube.com/watch?v=${videoId}${startAt > 0 ? `&t=${Math.floor(startAt)}s` : ""}`;
  return (
    <div className="player-frame flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-6 text-center">
      <p className="max-w-md text-[13.5px] leading-relaxed text-muted">
        {blocked
          ? "This video can't be embedded — the uploader has turned embedding off."
          : "The embedded player couldn't start."}
      </p>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded-md border border-line px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent hover:text-accent"
      >
        Watch “{title.length > 42 ? `${title.slice(0, 42)}…` : title}” on YouTube ↗
      </a>
    </div>
  );
}
