import Link from "next/link";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import { RefreshButton } from "./RefreshButton";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Feed" },
  { href: "/subscriptions", label: "Channels" },
  { href: "/discover", label: "Discover" },
  { href: "/learn", label: "Learn" },
  { href: "/later", label: "Later" },
  { href: "/history", label: "History" },
  { href: "/digest", label: "Digest" },
];

export async function Header() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1 px-5 sm:px-8">
        <Link
          href="/"
          className="mr-3 flex shrink-0 items-baseline gap-2.5 rounded-md text-[15px] font-medium tracking-tight"
        >
          <span className="inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full bg-accent" />
          Quiet
        </Link>

        {signedIn && (
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {signedIn && (
            <>
              <Link
                href="/search"
                aria-label="Search"
                className="rounded-md p-2 text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
              </Link>
              <RefreshButton />
            </>
          )}
          <ThemeToggle />
          {signedIn && (
            <>
              <Link
                href="/settings"
                aria-label="Settings"
                className="rounded-md p-2 text-faint transition-colors hover:bg-raised hover:text-ink"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.4.65.73.85" />
                </svg>
              </Link>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="rounded-md px-2.5 py-2 text-[13px] text-faint transition-colors hover:bg-raised hover:text-ink"
                >
                  Sign out
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
