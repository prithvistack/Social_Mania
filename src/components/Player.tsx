"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<any> | null = null;

/** Loads the IFrame API once per page, no matter how many players mount. */
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

export function Player({
  videoId,
  title,
  embeddable = true,
}: {
  videoId: string;
  title: string;
  /** Comes from the API's status.embeddable, so we can skip the player entirely. */
  embeddable?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [blocked, setBlocked] = useState(!embeddable);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!embeddable) return;
    let cancelled = false;

    loadIframeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;

        // The API swaps the element it is given for an <iframe>. Handing it a
        // div we create here — rather than one React rendered — keeps that
        // swap outside React's tree, so unmounting can't trip over a node
        // that is no longer where React left it.
        const mount = document.createElement("div");
        mount.style.width = "100%";
        mount.style.height = "100%";
        hostRef.current.appendChild(mount);

        playerRef.current = new YT.Player(mount, {
          videoId,
          playerVars: {
            // rel=0 keeps end-of-video suggestions limited to this channel —
            // YouTube no longer allows removing them outright, so we also stop
            // playback on ENDED below, which replaces the end screen with the
            // plain thumbnail.
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3, // no annotation overlays
            playsinline: 1,
            autoplay: 0,
            origin: window.location.origin,
          },
          events: {
            onError: (event: { data: number }) => {
              if (EMBED_BLOCKED.has(event.data)) setBlocked(true);
              else setFailed(true);
            },
            onStateChange: (event: { data: number }) => {
              if (event.data === window.YT?.PlayerState?.ENDED) {
                playerRef.current?.stopVideo?.();
              }
            },
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy?.();
      } catch {
        // The iframe may already be gone during a fast route change.
      }
      playerRef.current = null;
      // Clear anything destroy() left behind, so a re-mount starts clean.
      if (hostRef.current) hostRef.current.replaceChildren();
    };
  }, [videoId, embeddable]);

  if (blocked || failed) {
    return <Fallback videoId={videoId} title={title} blocked={blocked} />;
  }

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius-card)] bg-black">
      <div ref={hostRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}

function Fallback({
  videoId,
  title,
  blocked,
}: {
  videoId: string;
  title: string;
  blocked: boolean;
}) {
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-4 rounded-[var(--radius-card)] border border-line bg-surface px-6 text-center">
      <p className="max-w-md text-[13.5px] leading-relaxed text-muted">
        {blocked
          ? "This video can't be embedded — the uploader has turned embedding off."
          : "The embedded player couldn't start."}
      </p>
      <a
        href={`https://www.youtube.com/watch?v=${videoId}`}
        target="_blank"
        rel="noreferrer noopener"
        className="rounded-md border border-line px-3.5 py-2 text-[13px] text-ink transition-colors hover:border-accent hover:text-accent"
      >
        Watch “{title.length > 42 ? `${title.slice(0, 42)}…` : title}” on YouTube ↗
      </a>
    </div>
  );
}
