"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "quiet-theatre";

/**
 * Theatre mode, as on YouTube: a wide player with Related moved below.
 * The state lives on <html data-theatre>, which the layout's bootstrap script
 * sets before first paint, so a saved preference never flashes. Toggling only
 * changes CSS; the player iframe is never moved, so playback carries on.
 */
export function TheatreToggle() {
  const [on, setOn] = useState(false);

  const apply = useCallback((next: boolean) => {
    const root = document.documentElement;
    if (next) root.setAttribute("data-theatre", "");
    else root.removeAttribute("data-theatre");
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Private mode or blocked storage: the toggle still works for this visit.
    }
    setOn(next);
  }, []);

  useEffect(() => {
    setOn(document.documentElement.hasAttribute("data-theatre"));

    // "t" toggles, like YouTube. Ignored while typing, and when combined with
    // a modifier so it never hijacks a browser shortcut.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "t" && event.key !== "T") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      apply(!document.documentElement.hasAttribute("data-theatre"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [apply]);

  return (
    <button
      type="button"
      onClick={() => apply(!on)}
      aria-pressed={on}
      title={on ? "Default view (t)" : "Theatre mode (t)"}
      // Theatre mode only changes the layout on wide screens, matching YouTube.
      className={`hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] transition-colors lg:inline-flex ${
        on ? "text-accent" : "text-faint hover:text-ink"
      }`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
        {on ? (
          <rect x="5" y="7" width="14" height="10" rx="1.5" />
        ) : (
          <rect x="2" y="6" width="20" height="12" rx="1.5" />
        )}
      </svg>
      <span>{on ? "Default view" : "Theatre"}</span>
    </button>
  );
}
