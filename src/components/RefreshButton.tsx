"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { refreshFeedAction } from "@/app/actions";

export function RefreshButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      onClick={() =>
        start(async () => {
          await refreshFeedAction();
          router.refresh();
        })
      }
      disabled={pending}
      title="Fetch new uploads now"
      className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-50"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={pending ? "animate-spin" : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.6-6.4" />
        <path d="M21 3v6h-6" />
      </svg>
      <span className="hidden sm:inline">{pending ? "Refreshing" : "Refresh"}</span>
    </button>
  );
}
