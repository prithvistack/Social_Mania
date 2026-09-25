"use server";

import { revalidatePath } from "next/cache";
import { signIn, signOut } from "@/lib/auth";
import { getContext } from "@/lib/context";
import { refreshNow } from "@/lib/feed";
import { runDiscovery } from "@/lib/discovery";
import { QuotaBudgetError } from "@/lib/quota";

/**
 * Server Actions are reachable by direct POST regardless of which page
 * renders them, so every one of these re-verifies the session itself. A
 * page-level check does not protect the action defined beside it.
 */
async function ctxOrThrow() {
  const ctx = await getContext();
  if (!ctx) throw new Error("Not signed in.");
  return ctx;
}

export async function signInWithGoogle() {
  await signIn("google", { redirectTo: "/" });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/signin" });
}

export async function refreshFeedAction() {
  const ctx = await ctxOrThrow();
  try {
    await refreshNow(ctx);
  } catch (err) {
    if (!(err instanceof QuotaBudgetError)) throw err;
  }
  revalidatePath("/");
}

export async function toggleWatchLaterAction(videoId: string): Promise<boolean> {
  const ctx = await ctxOrThrow();
  if (!/^[\w-]{5,20}$/.test(videoId)) throw new Error("Invalid video id.");
  const added = await ctx.watchLater.toggle(videoId);
  revalidatePath("/later");
  return added;
}

export async function deleteHistoryEntryAction(id: number) {
  const ctx = await ctxOrThrow();
  if (!Number.isInteger(id) || id <= 0) throw new Error("Invalid history id.");
  await ctx.history.deleteEntry(id);
  revalidatePath("/history");
  revalidatePath("/discover");
}

export async function deleteHistoryRangeAction(formData: FormData) {
  const ctx = await ctxOrThrow();
  const from = String(formData.get("from") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!from || !to) throw new Error("Both dates are required.");

  const fromIso = new Date(`${from}T00:00:00`).toISOString();
  const toIso = new Date(`${to}T23:59:59.999`).toISOString();
  if (Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) {
    throw new Error("Invalid date range.");
  }

  await ctx.history.deleteRange(fromIso, toIso);
  revalidatePath("/history");
  revalidatePath("/discover");
}

export async function clearHistoryAction(formData: FormData) {
  const ctx = await ctxOrThrow();
  // Typed confirmation, so a stray POST cannot wipe history.
  if (String(formData.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") {
    throw new Error('Type DELETE to confirm clearing your history.');
  }
  await ctx.history.clearAll();
  revalidatePath("/history");
  revalidatePath("/discover");
  revalidatePath("/digest");
}

export async function dismissSuggestionAction(channelId: string) {
  const ctx = await ctxOrThrow();
  await ctx.discover.dismiss(channelId);
  revalidatePath("/discover");
}

export async function refreshDiscoverAction() {
  const ctx = await ctxOrThrow();
  try {
    await runDiscovery(ctx, { force: true });
  } catch (err) {
    if (!(err instanceof QuotaBudgetError)) throw err;
  }
  revalidatePath("/discover");
}

export async function startCourseAction(playlistId: string, reason: string) {
  const ctx = await ctxOrThrow();
  if (!/^[\w-]{10,60}$/.test(playlistId)) throw new Error("Invalid playlist id.");

  // Pull the lecture list once so progress can be computed from history.
  const existing = await ctx.courses.playlistItems(playlistId);
  if (existing.length === 0) {
    try {
      const items = await ctx.client.listPlaylistItems(playlistId, 200);
      await ctx.courses.setPlaylistItems(playlistId, items);
      const missing = await ctx.videos.idsNeedingDetail(items.map((i) => i.videoId));
      if (missing.length > 0) {
        const detailed = await ctx.client.listVideos(missing);
        await ctx.videos.upsertChannels(
          [...new Map(detailed.map((d) => [d.channelId, d])).values()].map((d) => ({
            channel_id: d.channelId,
            title: d.channelTitle,
          })),
        );
        await ctx.videos.applyDetails(detailed);
      }
    } catch (err) {
      if (!(err instanceof QuotaBudgetError)) throw err;
    }
  }

  await ctx.courses.start(playlistId, reason.slice(0, 500));
  revalidatePath("/");
  revalidatePath("/learn");
}

export async function archiveCourseAction(playlistId: string) {
  const ctx = await ctxOrThrow();
  await ctx.courses.archive(playlistId);
  revalidatePath("/");
}
