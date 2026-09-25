"use server";

import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/lib/auth";
import { invalidateFeed } from "@/lib/feed";

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

/** Drops the cached feed so the next render pulls fresh uploads from YouTube. */
export async function refreshFeedAction() {
  await invalidateFeed();
  revalidatePath("/");
}
