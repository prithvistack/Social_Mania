"use client";

import { useTransition } from "react";
import { refreshDiscoverAction } from "@/app/actions";

export function RefreshDiscoverButton() {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => refreshDiscoverAction())}
      className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
    >
      {pending ? "Recomputing…" : "Recompute now"}
    </button>
  );
}
