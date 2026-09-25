import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { signInWithGoogle } from "@/app/actions";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied:
    "That Google account isn't the one this app is set up for. Check ALLOWED_EMAIL in your environment.",
  Configuration:
    "Google OAuth isn't configured. Set AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET and AUTH_SECRET.",
  RefreshFailed: "Your YouTube access expired. Signing in again will fix it.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await auth();
  if (session?.user && !session.error) redirect("/");

  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in didn't complete. Try once more.") : null;

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center gap-8 py-20">
      <div className="flex flex-col gap-3">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
        <h1 className="text-2xl font-medium tracking-tight">Quiet</h1>
        <p className="text-[14px] leading-relaxed text-muted">
          Your YouTube subscriptions, in the order they were published. No recommendations,
          no trending, no autoplay into the void.
        </p>
      </div>

      {message && (
        <p className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">
          {message}
        </p>
      )}

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="flex w-full items-center justify-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 text-[14px] transition-colors hover:border-accent hover:text-accent"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
            <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z" />
            <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3c1.9 3.8 5.8 6.3 10.2 6.3z" />
            <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.7l3.8-3z" />
            <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.7 1.2 15.1 0 12 0 7.6 0 3.7 2.5 1.8 6.2l3.8 3C6.5 6.7 9 4.8 12 4.8z" />
          </svg>
          Continue with Google
        </button>
      </form>

      <p className="text-[12px] leading-relaxed text-faint">
        Read-only access to your subscriptions and public video data. Nothing is posted,
        liked, or written back to your account.
      </p>
    </div>
  );
}
