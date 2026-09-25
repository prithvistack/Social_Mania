import Link from "next/link";
import { auth } from "@/lib/auth";
import { signOutAction } from "@/app/actions";
import { RefreshButton } from "./RefreshButton";
import { ThemeToggle } from "./ThemeToggle";

export async function Header() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-5 sm:px-8">
        <Link
          href="/"
          className="mr-auto flex items-baseline gap-2.5 rounded-md text-[15px] font-medium tracking-tight"
        >
          <span className="inline-block h-1.5 w-1.5 translate-y-[-2px] rounded-full bg-accent" />
          Quiet
          <span className="hidden text-[12px] font-normal text-faint sm:inline">
            your subscriptions, in order
          </span>
        </Link>

        {signedIn && (
          <>
            <Link
              href="/subscriptions"
              className="rounded-md px-2.5 py-2 text-[13px] text-muted transition-colors hover:bg-raised hover:text-ink"
            >
              Channels
            </Link>
            <RefreshButton />
          </>
        )}

        <ThemeToggle />

        {signedIn && (
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-md px-2.5 py-2 text-[13px] text-faint transition-colors hover:bg-raised hover:text-ink"
            >
              Sign out
            </button>
          </form>
        )}
      </div>
    </header>
  );
}
