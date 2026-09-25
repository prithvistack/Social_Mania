import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Proves the OAuth round-trip actually worked, without printing the token.
 *
 * Reports who is signed in, whether an access token reached the session, which
 * scopes Google actually granted, and whether that token can really read the
 * YouTube account. Useful right after a first sign-in; safe to delete after.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json(
      { signedIn: false, hint: "Sign in at http://localhost:3000/signin first." },
      { status: 401 },
    );
  }

  const token = session.accessToken;
  const report: Record<string, unknown> = {
    signedIn: true,
    email: session.user.email,
    name: session.user.name,
    accessTokenInSession: Boolean(token),
    refreshError: session.error ?? null,
  };

  if (!token) {
    report.problem = "Signed in, but no access token was persisted into the session.";
    return NextResponse.json(report, { status: 500 });
  }

  // What did Google actually consent to? This is the authoritative answer.
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(token)}`,
    );
    const info = (await res.json()) as { scope?: string; expires_in?: string };
    const scopes = info.scope?.split(" ") ?? [];
    report.grantedScopes = scopes;
    report.hasYouTubeReadonly = scopes.includes(
      "https://www.googleapis.com/auth/youtube.readonly",
    );
    report.tokenExpiresInSeconds = info.expires_in ? Number(info.expires_in) : null;
  } catch (err) {
    report.tokenInfoError = (err as Error).message;
  }

  // And can it actually read the account? One real, 1-unit API call.
  try {
    const res = await fetch(
      "https://www.googleapis.com/youtube/v3/subscriptions?part=id&mine=true&maxResults=1",
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
    );
    const body = (await res.json()) as {
      pageInfo?: { totalResults?: number };
      error?: { message?: string };
    };
    report.youtubeCall = res.ok
      ? { ok: true, subscriptionCount: body.pageInfo?.totalResults ?? null }
      : { ok: false, status: res.status, message: body.error?.message };
  } catch (err) {
    report.youtubeCall = { ok: false, message: (err as Error).message };
  }

  return NextResponse.json(report);
}
