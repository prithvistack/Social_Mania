/**
 * The part of the learning assistant that must be verifiable: turning the
 * model's picks into real courses. Pure, no SDK, no server-only import.
 */

export type CourseCandidate = {
  playlistId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  thumbnail: string;
  itemCount: number;
};

export type Recommendation = CourseCandidate & { why: string };

export type ModelPick = { playlist_id: string; why: string; order: number };

export const MAX_PLAYLISTS_IN_PROMPT = 120;

/** The catalogue text handed to the model. Only real, fetched playlists. */
export function renderCatalogue(catalogue: CourseCandidate[]): string {
  return catalogue
    .slice(0, MAX_PLAYLISTS_IN_PROMPT)
    .map(
      (c) =>
        `- playlist_id: ${c.playlistId}\n  title: ${c.title}\n  channel: ${c.channelTitle}\n  videos: ${c.itemCount}\n  about: ${c.description.slice(0, 200).replace(/\s+/g, " ")}`,
    )
    .join("\n");
}

/**
 * The hard guarantee behind "never recommend a course that doesn't exist":
 * a pick is kept only if its id is one we actually fetched from YouTube.
 * Anything else — a hallucinated id, a plausible-looking near-miss, a
 * duplicate — is dropped and reported, never rendered.
 */
export function groundPicks(
  picks: ModelPick[],
  catalogue: CourseCandidate[],
): { recommendations: Recommendation[]; rejected: string[] } {
  const byId = new Map(catalogue.map((c) => [c.playlistId, c]));
  const recommendations: Recommendation[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const pick of [...picks].sort((a, b) => a.order - b.order)) {
    const course = byId.get(pick.playlist_id);
    if (!course) {
      rejected.push(pick.playlist_id);
      continue;
    }
    if (seen.has(course.playlistId)) continue;
    seen.add(course.playlistId);
    recommendations.push({ ...course, why: pick.why });
  }

  return { recommendations, rejected };
}
