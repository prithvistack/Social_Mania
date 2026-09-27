"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { THEATRE_EVENT, isTheatre, setTheatre } from "@/lib/theatre";

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
/** Controls fade after this long without pointer movement, while playing. */
const IDLE_HIDE_MS = 2500;
const VOLUME_KEY = "quiet-volume";
const CAPTIONS_KEY = "quiet-captions";

/** YouTube's captions module being loaded is the only reliable "captions on" signal. */
function captionsShowing(p: any): boolean {
  try {
    return (p?.getOptions?.() ?? []).includes("captions");
  } catch {
    return false;
  }
}

const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/**
 * YouTube's embed, with YouTube's own controls turned off and replaced by
 * ours. Its redesigned embed controls are thin white icons scattered to the
 * corners, which vanish on bright videos; this bar is always at the bottom,
 * on a dark gradient, like the classic player or an OTT app.
 *
 * Fullscreen is requested on our container rather than on YouTube's iframe,
 * so the bar stays visible in fullscreen. A transparent layer sits over the
 * iframe, so clicks and keystrokes stay with this page and every keyboard
 * shortcut keeps working after you click the video.
 *
 * Quality isn't offered: YouTube's API no longer lets embeds choose it.
 */
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
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [blocked, setBlocked] = useState(!embeddable);
  const [failed, setFailed] = useState(false);

  // --- playback state mirrored from the player ---------------------------
  const [ready, setReady] = useState(false);
  const [state, setState] = useState(STATE.UNSTARTED);
  const [time, setTime] = useState(startAt);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [volume, setVolumeState] = useState(100);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [rates, setRates] = useState<number[]>([1]);
  const [ccOn, setCcOn] = useState(false);
  const captionsSynced = useRef(false);

  // --- UI state -----------------------------------------------------------
  const [fullscreen, setFullscreen] = useState(false);
  const [theatre, setTheatreState] = useState(false);
  const [active, setActive] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null); // fraction while dragging
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [flash, setFlash] = useState<{ text: string; key: number } | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- watch-history tracking (unchanged behaviour) ----------------------
  // Seconds actually spent playing, accumulated from state changes rather
  // than read off currentTime, so scrubbing around doesn't inflate the total.
  const watchedRef = useRef(0);
  const lastTickRef = useRef<number | null>(null);
  const sentRef = useRef(0);

  const flush = useCallback(
    (useBeacon: boolean) => {
      const player = playerRef.current;
      if (!player?.getCurrentTime) return;

      let position = 0;
      let length = 0;
      try {
        position = Math.floor(player.getCurrentTime() ?? 0);
        length = Math.floor(player.getDuration() ?? 0);
      } catch {
        return;
      }

      const watched = Math.floor(watchedRef.current);
      if (watched <= 0 || (watched === sentRef.current && position === 0)) return;
      sentRef.current = watched;

      const payload = JSON.stringify({
        videoId,
        channelId,
        positionSeconds: position,
        secondsWatched: watched,
        durationSeconds: length,
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

  const bankPlayTime = () => {
    if (lastTickRef.current) {
      watchedRef.current += (Date.now() - lastTickRef.current) / 1000;
      lastTickRef.current = null;
    }
  };

  // --- create the player ---------------------------------------------------
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
            controls: 0, // ours replace YouTube's
            disablekb: 1, // our shortcuts replace YouTube's
            fs: 0, // fullscreen is ours, so the bar survives it
            rel: 0, // end-of-video suggestions limited to this channel
            iv_load_policy: 3, // no annotation overlays
            playsinline: 1,
            autoplay: 0,
            start: startAt > 0 ? Math.floor(startAt) : undefined,
            origin: window.location.origin,
          },
          events: {
            onReady: (event: any) => {
              const p = event.target;
              try {
                const saved = JSON.parse(localStorage.getItem(VOLUME_KEY) ?? "null");
                if (saved && typeof saved.volume === "number") {
                  p.setVolume(saved.volume);
                  if (saved.muted) p.mute();
                  else p.unMute();
                }
              } catch {
                // No saved volume, or storage blocked — YouTube's default stands.
              }
              setVolumeState(p.getVolume?.() ?? 100);
              setMuted(p.isMuted?.() ?? false);
              setRates(p.getAvailablePlaybackRates?.() ?? [1]);
              setDuration(p.getDuration?.() ?? 0);
              setReady(true);
            },
            onError: (event: { data: number }) => {
              if (EMBED_BLOCKED.has(event.data)) setBlocked(true);
              else setFailed(true);
            },
            onPlaybackRateChange: (event: { data: number }) => setRate(event.data),
            onStateChange: (event: { data: number }) => {
              setState(event.data);
              if (event.data === STATE.PLAYING) {
                lastTickRef.current = Date.now();
                const p = playerRef.current;
                setDuration(p?.getDuration?.() ?? 0);
                // Captions state is only knowable once playback has begun.
                // YouTube's tracklist comes back empty even while auto
                // captions are showing, so the module itself is the signal.
                // Apply the saved preference once per video.
                if (!captionsSynced.current) {
                  captionsSynced.current = true;
                  let pref: string | null = null;
                  try {
                    pref = localStorage.getItem(CAPTIONS_KEY);
                  } catch {
                    // Storage blocked: follow YouTube's default.
                  }
                  const showing = captionsShowing(p);
                  if (pref === "off" && showing) p.unloadModule?.("captions");
                  if (pref === "on" && !showing) p.loadModule?.("captions");
                  setCcOn(pref ? pref === "on" : showing);
                }
              } else {
                bankPlayTime();
                if (event.data === STATE.ENDED) {
                  flush(false);
                  // Stopping replaces YouTube's end screen with the thumbnail.
                  playerRef.current?.stopVideo?.();
                } else if (event.data === STATE.PAUSED) {
                  flush(false);
                }
              }
            },
          },
        });
      })
      .catch(() => !cancelled && setFailed(true));

    // The API has no timeupdate event, so the bar polls.
    const poll = setInterval(() => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      try {
        setTime(p.getCurrentTime());
        setLoaded(p.getVideoLoadedFraction?.() ?? 0);
        const d = p.getDuration?.();
        if (d) setDuration(d);
      } catch {
        // Player mid-teardown.
      }
    }, 250);

    const flushTimer = setInterval(() => {
      if (lastTickRef.current) {
        const now = Date.now();
        watchedRef.current += (now - lastTickRef.current) / 1000;
        lastTickRef.current = now;
        flush(false);
      }
    }, FLUSH_INTERVAL_MS);

    // visibilitychange is the reliable unload signal on mobile; pagehide
    // covers the rest. beforeunload alone is not dependable.
    const onHide = () => {
      bankPlayTime();
      flush(true);
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearInterval(flushTimer);
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
    // flush is stable per video; startAt only matters at creation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, embeddable, startAt, flush]);

  // --- actions -----------------------------------------------------------
  const playing = state === STATE.PLAYING || state === STATE.BUFFERING;

  const showFlash = (text: string) => setFlash({ text, key: Date.now() });

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p?.getPlayerState) return;
    const s = p.getPlayerState();
    if (s === STATE.PLAYING || s === STATE.BUFFERING) p.pauseVideo();
    else p.playVideo();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const p = playerRef.current;
    if (!p?.seekTo) return;
    const d = p.getDuration?.() || 0;
    const target = Math.max(0, d ? Math.min(seconds, d - 0.5) : seconds);
    p.seekTo(target, true);
    setTime(target);
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const p = playerRef.current;
      if (!p?.getCurrentTime) return;
      seekTo(p.getCurrentTime() + delta);
      showFlash(`${delta > 0 ? "+" : "−"}${Math.abs(delta)}s`);
    },
    [seekTo],
  );

  const persistVolume = (v: number, m: boolean) => {
    try {
      localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: v, muted: m }));
    } catch {
      // Storage blocked: the setting lasts for this page only.
    }
  };

  const applyVolume = useCallback((v: number) => {
    const p = playerRef.current;
    if (!p?.setVolume) return;
    const next = Math.round(Math.max(0, Math.min(100, v)));
    p.setVolume(next);
    if (next > 0) p.unMute();
    else p.mute();
    setVolumeState(next);
    setMuted(next === 0);
    persistVolume(next, next === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p?.isMuted) return;
    if (p.isMuted()) {
      p.unMute();
      // Unmuting at zero would be silent, which reads as broken.
      if ((p.getVolume?.() ?? 0) === 0) p.setVolume(50);
      setMuted(false);
      setVolumeState(p.getVolume?.() ?? 50);
      persistVolume(p.getVolume?.() ?? 50, false);
      showFlash("Sound on");
    } else {
      p.mute();
      setMuted(true);
      persistVolume(p.getVolume?.() ?? volume, true);
      showFlash("Muted");
    }
  }, [volume]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);

  const toggleCaptions = useCallback(() => {
    const p = playerRef.current;
    if (!p?.loadModule) return;
    const next = !ccOn;
    try {
      localStorage.setItem(CAPTIONS_KEY, next ? "on" : "off");
    } catch {
      // Storage blocked: the choice lasts for this video only.
    }
    if (!next) {
      p.unloadModule("captions");
      setCcOn(false);
      showFlash("Captions off");
      return;
    }
    p.loadModule("captions");
    setCcOn(true);
    showFlash("Captions on");
    // Not every video has captions. If the module never appears, say so
    // rather than leaving a button that claims captions are on.
    setTimeout(() => {
      if (!captionsShowing(playerRef.current)) {
        setCcOn(false);
        showFlash("No captions for this video");
      }
    }, 1500);
  }, [ccOn]);

  const changeRate = useCallback((next: number) => {
    playerRef.current?.setPlaybackRate?.(next);
    setRate(next);
    setMenuOpen(false);
    showFlash(next === 1 ? "Normal speed" : `${next}×`);
  }, []);

  const toggleTheatre = useCallback(() => setTheatre(!isTheatre()), []);

  // --- fullscreen and theatre state --------------------------------------
  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === rootRef.current);
    const onTheatre = () => setTheatreState(isTheatre());
    onTheatre();
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener(THEATRE_EVENT, onTheatre);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener(THEATRE_EVENT, onTheatre);
    };
  }, []);

  // --- auto-hide ---------------------------------------------------------
  const wake = useCallback(() => {
    setActive(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_HIDE_MS);
  }, []);

  useEffect(() => () => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  const controlsVisible = !playing || active || menuOpen || scrub !== null;

  // --- keyboard shortcuts (YouTube's set) --------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input:not([data-player-control]), textarea, select, [contenteditable='true']")) return;
      if (!playerRef.current?.getPlayerState) return;

      const k = event.key;
      const handled = () => {
        event.preventDefault();
        wake();
      };
      if (k === " " || k === "k" || k === "K") { handled(); togglePlay(); }
      else if (k === "j" || k === "J") { handled(); seekBy(-10); }
      else if (k === "l" || k === "L") { handled(); seekBy(10); }
      else if (k === "ArrowLeft") { handled(); seekBy(-5); }
      else if (k === "ArrowRight") { handled(); seekBy(5); }
      else if (k === "ArrowUp") { handled(); applyVolume(volume + 5); showFlash(`${Math.min(100, volume + 5)}%`); }
      else if (k === "ArrowDown") { handled(); applyVolume(volume - 5); showFlash(`${Math.max(0, volume - 5)}%`); }
      else if (k === "m" || k === "M") { handled(); toggleMute(); }
      else if (k === "f" || k === "F") { handled(); toggleFullscreen(); }
      else if (k === "c" || k === "C") { handled(); toggleCaptions(); }
      else if (k === "t" || k === "T") { handled(); toggleTheatre(); }
      else if (k === "Escape" && menuOpen) { handled(); setMenuOpen(false); }
      else if (/^[0-9]$/.test(k) && duration) { handled(); seekTo((Number(k) / 10) * duration); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, seekBy, applyVolume, volume, toggleMute, toggleFullscreen, toggleCaptions, toggleTheatre, menuOpen, duration, seekTo, wake]);

  // --- click vs double-click on the video --------------------------------
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSurfaceClick = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    // Wait briefly so a double-click toggles fullscreen without also
    // pausing, as YouTube does.
    if (clickTimer.current) return;
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      togglePlay();
    }, 220);
  };
  const onSurfaceDoubleClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    toggleFullscreen();
  };

  // --- seek bar ----------------------------------------------------------
  const barRef = useRef<HTMLDivElement>(null);
  const fractionAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const onBarPointerDown = (event: React.PointerEvent) => {
    if (!duration) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    setScrub(fractionAt(event.clientX));
  };
  const onBarPointerMove = (event: React.PointerEvent) => {
    const f = fractionAt(event.clientX);
    const rect = barRef.current!.getBoundingClientRect();
    setHover({ x: f * rect.width, t: f * duration });
    if (scrub !== null) setScrub(f);
  };
  const onBarPointerUp = (event: React.PointerEvent) => {
    if (scrub === null) return;
    seekTo(fractionAt(event.clientX) * duration);
    setScrub(null);
  };

  if (blocked || failed) {
    return <Fallback videoId={videoId} title={title} blocked={blocked} startAt={startAt} />;
  }

  const shown = scrub !== null ? scrub * duration : time;
  const played = duration ? Math.min(1, shown / duration) : 0;
  const started = state !== STATE.UNSTARTED && state !== STATE.CUED;
  const iconVolume = muted || volume === 0 ? "muted" : volume < 50 ? "low" : "high";

  return (
    <div
      ref={rootRef}
      onPointerMove={wake}
      onPointerLeave={() => playing && setActive(false)}
      className={`player-frame group/player relative aspect-video w-full select-none overflow-hidden rounded-[var(--radius-card)] bg-black ${
        controlsVisible ? "" : "cursor-none"
      }`}
    >
      {/* YouTube's iframe. Pointer events go to the layer above instead. */}
      <div ref={hostRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* Click to play/pause, double-click for fullscreen. */}
      <div
        className="absolute inset-0 z-10"
        onClick={onSurfaceClick}
        onDoubleClick={onSurfaceDoubleClick}
        aria-hidden
      />

      {/* Large play button before the first play and whenever paused. */}
      {ready && !playing && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label={started ? "Play" : `Play ${title}`}
          className="absolute left-1/2 top-1/2 z-20 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-transform hover:scale-105"
        >
          <PlayIcon className="ml-1 h-7 w-7" />
        </button>
      )}

      {state === STATE.BUFFERING && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 h-12 w-12 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-[3px] border-white/25 border-t-white" />
      )}

      {/* Brief centre feedback for shortcuts: "+10s", "65%", "Muted". */}
      {flash && (
        <div
          key={flash.key}
          className="player-flash pointer-events-none absolute left-1/2 top-[18%] z-20 -translate-x-1/2 rounded-md bg-black/65 px-3.5 py-1.5 text-[14px] font-medium tabular-nums text-white"
          onAnimationEnd={() => setFlash(null)}
        >
          {flash.text}
        </div>
      )}

      {/* Bottom control bar. */}
      <div
        className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2 pt-14 text-white transition-opacity duration-300 sm:px-4 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Seek bar */}
        <div
          ref={barRef}
          role="slider"
          tabIndex={-1}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={Math.floor(shown)}
          aria-valuetext={`${clock(shown)} of ${clock(duration)}`}
          onPointerDown={onBarPointerDown}
          onPointerMove={onBarPointerMove}
          onPointerUp={onBarPointerUp}
          onPointerLeave={() => setHover(null)}
          className="group/bar relative -mx-1 flex h-4 cursor-pointer items-center px-1"
        >
          <div className="relative h-[3px] w-full rounded-full bg-white/25 transition-[height] group-hover/bar:h-[5px]">
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/40" style={{ width: `${loaded * 100}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${played * 100}%` }} />
            <div
              className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-transform ${
                scrub !== null ? "scale-100" : "scale-0 group-hover/bar:scale-100"
              }`}
              style={{ left: `${played * 100}%` }}
            />
          </div>
          {hover && duration > 0 && (
            <div
              className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded bg-black/80 px-2 py-0.5 text-[12px] font-medium tabular-nums"
              style={{ left: Math.max(24, Math.min(hover.x + 4, (barRef.current?.clientWidth ?? 0) - 24)) }}
            >
              {clock(scrub !== null ? scrub * duration : hover.t)}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="mt-1 flex items-center gap-1 sm:gap-1.5">
          <CtrlButton label={playing ? "Pause (k)" : "Play (k)"} onClick={togglePlay}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </CtrlButton>
          <CtrlButton label="Back 10 seconds (j)" onClick={() => seekBy(-10)}>
            <SkipIcon back />
          </CtrlButton>
          <CtrlButton label="Forward 10 seconds (l)" onClick={() => seekBy(10)}>
            <SkipIcon />
          </CtrlButton>

          {/* Volume: the slider opens on hover, as on YouTube. */}
          <div className="group/vol flex items-center">
            <CtrlButton label={muted ? "Unmute (m)" : "Mute (m)"} onClick={toggleMute}>
              <VolumeIcon level={iconVolume} />
            </CtrlButton>
            <input
              data-player-control
              type="range"
              min={0}
              max={100}
              step={1}
              value={muted ? 0 : volume}
              onChange={(e) => applyVolume(Number(e.target.value))}
              aria-label="Volume"
              className="player-volume w-0 cursor-pointer opacity-0 transition-all duration-200 group-hover/vol:ml-1 group-hover/vol:w-20 group-hover/vol:opacity-100 focus-visible:ml-1 focus-visible:w-20 focus-visible:opacity-100"
              style={{ ["--vol" as any]: `${muted ? 0 : volume}%` }}
            />
          </div>

          <span className="ml-2 whitespace-nowrap text-[13px] font-medium tabular-nums text-white/90">
            {clock(shown)}
            <span className="text-white/55"> / {clock(duration)}</span>
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-1.5">
            {started && (
              <CtrlButton label={ccOn ? "Captions off (c)" : "Captions on (c)"} onClick={toggleCaptions} active={ccOn}>
                <CaptionsIcon />
              </CtrlButton>
            )}

            <div className="relative">
              <CtrlButton label="Playback speed" onClick={() => setMenuOpen((o) => !o)} active={menuOpen}>
                <GearIcon />
              </CtrlButton>
              {menuOpen && (
                <div
                  role="menu"
                  className="absolute bottom-11 right-0 min-w-[9.5rem] overflow-hidden rounded-lg bg-black/90 py-1.5 text-[13px] shadow-xl backdrop-blur-md"
                >
                  <p className="px-3.5 pb-1 pt-1 text-[11px] uppercase tracking-[0.12em] text-white/50">
                    Speed
                  </p>
                  {rates.map((r) => (
                    <button
                      key={r}
                      role="menuitemradio"
                      aria-checked={r === rate}
                      type="button"
                      onClick={() => changeRate(r)}
                      className="flex w-full items-center justify-between px-3.5 py-1.5 text-left hover:bg-white/10"
                    >
                      <span>{r === 1 ? "Normal" : `${r}×`}</span>
                      {r === rate && <span className="text-accent">✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Theatre only changes layout on wide screens, and never in fullscreen. */}
            {!fullscreen && (
              <span className="hidden lg:inline-flex">
                <CtrlButton label={theatre ? "Default view (t)" : "Theatre mode (t)"} onClick={toggleTheatre} active={theatre}>
                  <TheatreIcon on={theatre} />
                </CtrlButton>
              </span>
            )}

            <CtrlButton label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen}>
              <FullscreenIcon exit={fullscreen} />
            </CtrlButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function CtrlButton({
  label,
  onClick,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-white/15 ${
        active ? "text-accent" : "text-white"
      }`}
    >
      {children}
    </button>
  );
}

// --- icons (inline so nothing loads from elsewhere) -------------------------

const svg = "h-[22px] w-[22px]";

function PlayIcon({ className = svg }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="currentColor" aria-hidden>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function SkipIcon({ back = false }: { back?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {back ? (
        <>
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v4.5h4.5" />
        </>
      ) : (
        <>
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 4v4.5h-4.5" />
        </>
      )}
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none">10</text>
    </svg>
  );
}
function VolumeIcon({ level }: { level: "muted" | "low" | "high" }) {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
      {level === "muted" && <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      {level !== "muted" && <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />}
      {level === "high" && <path d="M18.2 6.6a7.8 7.8 0 0 1 0 10.8" />}
    </svg>
  );
}
function CaptionsIcon() {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M10.5 10.3a2.3 2.3 0 1 0 0 3.4M17 10.3a2.3 2.3 0 1 0 0 3.4" strokeLinecap="round" />
    </svg>
  );
}
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
function TheatreIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      {on ? <rect x="5" y="7" width="14" height="10" rx="1.5" /> : <rect x="2" y="6" width="20" height="12" rx="1.5" />}
    </svg>
  );
}
function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={svg} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {exit ? (
        <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      ) : (
        <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      )}
    </svg>
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
