import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const YOUTUBE_SCOPE = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/youtube.readonly",
].join(" ");

declare module "next-auth" {
  interface Session {
    accessToken?: string;
    error?: "RefreshFailed";
  }
}

// Augmenting @auth/core/jwt rather than next-auth/jwt: the latter is a bare
// re-export, which TypeScript will not accept as an augmentation target.
declare module "@auth/core/jwt" {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    error?: "RefreshFailed";
  }
}

/**
 * Google only hands out a refresh token on the first consent, so we ask for
 * offline access with prompt=consent to make sure we always get one.
 */
async function refresh(refreshToken: string) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID!,
      client_secret: process.env.AUTH_GOOGLE_SECRET!,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      authorization: {
        params: {
          scope: YOUTUBE_SCOPE,
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: { signIn: "/signin", error: "/signin" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 },
  callbacks: {
    // This app is for exactly one person. Anyone else who finds the URL and
    // completes a Google login is turned away here.
    signIn({ profile }) {
      const allowed = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
      if (!allowed) return true;
      return profile?.email?.toLowerCase() === allowed;
    },

    async jwt({ token, account }) {
      if (account) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token ?? token.refreshToken,
          expiresAt: account.expires_at
            ? account.expires_at * 1000
            : Date.now() + 3_500_000,
          error: undefined,
        };
      }

      // Renew a minute early so an in-flight request never races the expiry.
      if (token.expiresAt && Date.now() < token.expiresAt - 60_000) return token;
      if (!token.refreshToken) return { ...token, error: "RefreshFailed" };

      try {
        const next = await refresh(token.refreshToken);
        return {
          ...token,
          accessToken: next.access_token,
          refreshToken: next.refresh_token ?? token.refreshToken,
          expiresAt: Date.now() + next.expires_in * 1000,
          error: undefined,
        };
      } catch {
        return { ...token, error: "RefreshFailed" };
      }
    },

    session({ session, token }) {
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
});

/** Returns a usable access token, or null if the caller needs to sign in again. */
export async function getAccessToken(): Promise<string | null> {
  const session = await auth();
  if (!session || session.error || !session.accessToken) return null;
  return session.accessToken;
}
