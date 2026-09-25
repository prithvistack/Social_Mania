"use client";

import { useState, useTransition } from "react";
import {
  clearHistoryAction,
  deleteHistoryEntryAction,
  deleteHistoryRangeAction,
} from "@/app/actions";

export function DeleteEntryButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => deleteHistoryEntryAction(id))}
      aria-label="Remove from history"
      title="Remove from history"
      className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>
  );
}

export function HistoryTools() {
  const [open, setOpen] = useState<"none" | "range" | "clear">("none");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === "range" ? "none" : "range")}
          className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:text-ink"
        >
          Delete a date range
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === "clear" ? "none" : "clear")}
          className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-red-500/50 hover:text-ink"
        >
          Clear all history
        </button>
      </div>

      {open === "range" && (
        <form
          action={deleteHistoryRangeAction}
          className="flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5"
        >
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-faint">
            From
            <input
              type="date"
              name="from"
              required
              className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-faint">
            To
            <input
              type="date"
              name="to"
              required
              className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink"
            />
          </label>
          <button
            type="submit"
            className="rounded-md border border-line px-3 py-2 text-[12.5px] transition-colors hover:border-accent hover:text-accent"
          >
            Delete range
          </button>
        </form>
      )}

      {open === "clear" && (
        <form
          action={clearHistoryAction}
          className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5"
        >
          <p className="text-[13px] leading-relaxed text-muted">
            This deletes every watch record, every resume point, and everything derived from
            them — your topic profile and the reasons behind Discover suggestions. Courses
            you started will show zero progress again. It cannot be undone.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.12em] text-faint">
              Type DELETE to confirm
              <input
                name="confirm"
                required
                autoComplete="off"
                placeholder="DELETE"
                className="rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[13px] text-ink"
              />
            </label>
            <button
              type="submit"
              className="rounded-md border border-line px-3 py-2 text-[12.5px] text-muted transition-colors hover:border-red-500/60 hover:text-ink"
            >
              Clear everything
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
