import Link from "next/link";
import type { SortKey } from "@/lib/feed";

const TABS: { key: SortKey; label: string }[] = [
  { key: "newest", label: "Newest" },
  { key: "views", label: "Most viewed" },
  { key: "likes", label: "Most liked" },
];

export function SortTabs({ basePath, active }: { basePath: string; active: SortKey }) {
  return (
    <nav className="flex items-center gap-1 border-b border-line">
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.key === "newest" ? basePath : `${basePath}?sort=${tab.key}`}
            scroll={false}
            aria-current={selected ? "page" : undefined}
            className={`-mb-px border-b px-3 py-2.5 text-[13px] transition-colors ${
              selected
                ? "border-accent text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
