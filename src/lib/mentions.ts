/**
 * Pulls channel references out of the video metadata already sitting in the
 * cache. Every function here is pure and costs zero quota — the only paid step
 * in discovery is turning a handle into a channel id (channels.list, 1 unit),
 * and that happens at most once per handle, ever.
 */

/** YouTube handles: 3-30 chars of letters, digits, underscore, hyphen, period. */
const HANDLE_BODY = "[A-Za-z0-9_.-]{3,30}";

const HANDLE_URL = new RegExp(
  `(?:https?://)?(?:www\\.)?youtube\\.com/@(${HANDLE_BODY})`,
  "g",
);
const CHANNEL_URL = new RegExp(
  `(?:https?://)?(?:www\\.)?youtube\\.com/channel/(UC[A-Za-z0-9_-]{20,24})`,
  "g",
);
/**
 * A bare @handle. The lookbehind rejects the local part of an email address
 * ("hello@example.com" must not read as the handle "example"), and the
 * trailing guard rejects a handle immediately followed by a dot-TLD.
 */
const BARE_HANDLE = new RegExp(`(?<![A-Za-z0-9_.+-])@(${HANDLE_BODY})`, "g");

const COMMON_TLDS = /\.(com|net|org|io|co|tv|me|gg|ai|dev|app|xyz|uk|in)$/i;

function normalizeHandle(raw: string): string | null {
  let handle = raw.trim().replace(/[.,;:!?)\]]+$/, "");
  if (handle.length < 3 || handle.length > 30) return null;
  // "gmail.com" and friends are the tail of an email, not a handle.
  if (COMMON_TLDS.test(handle)) return null;
  // A handle made only of digits and punctuation is almost certainly a
  // timestamp or a price that happened to follow an @.
  if (!/[A-Za-z]/.test(handle)) return null;
  return handle.toLowerCase();
}

function collect(re: RegExp, text: string): string[] {
  const out: string[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/** Every @handle referenced in the text, lowercased and de-duplicated. */
export function extractHandles(text: string): string[] {
  if (!text) return [];
  const found = [...collect(HANDLE_URL, text), ...collect(BARE_HANDLE, text)];
  const seen = new Set<string>();
  for (const raw of found) {
    const handle = normalizeHandle(raw);
    if (handle) seen.add(handle);
  }
  return [...seen];
}

/** Every /channel/UC... id referenced in the text. */
export function extractChannelIds(text: string): string[] {
  if (!text) return [];
  return [...new Set(collect(CHANNEL_URL, text))];
}

// Words that look like names but aren't, so a Title Case run containing one
// is discarded rather than guessed at.
const NAME_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "how", "why", "what", "when", "where", "who", "this", "that", "part", "episode",
  "ep", "podcast", "interview", "live", "full", "new", "best", "top", "official",
  "video", "special", "series", "season", "vol", "chapter", "lecture", "ai", "llm",
]);

const NAME_RUN = /\b([A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20}){1,2})\b/g;

/**
 * Markers that reliably precede a person's name in a podcast-style title.
 * Nothing is guessed without one of these — a bare Title Case run is far more
 * often a product or a place than a guest.
 */
const GUEST_MARKERS = [
  /\b(?:with|w\/)\s+/gi,
  /\b(?:ft|feat)\.?\s+/gi,
  /\binterview(?:ing|s)?\s+(?:with\s+)?/gi,
  /\bguest:?\s+/gi,
  /\bep(?:isode)?\.?\s*\d+\s*[:\-–—|]\s*/gi,
];

function looksLikeName(candidate: string): boolean {
  const words = candidate.split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return !words.some((w) => NAME_STOPWORDS.has(w.toLowerCase()));
}

/**
 * Best-effort guest names from a title. Deliberately conservative: a name is
 * only taken when it follows an explicit marker, or sits in the leading
 * "Name | Show" / "Name on Topic" slot that interview channels use.
 */
export function extractGuestNames(title: string): string[] {
  if (!title) return [];
  const found = new Set<string>();

  for (const marker of GUEST_MARKERS) {
    marker.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = marker.exec(title)) !== null) {
      const tail = title.slice(m.index + m[0].length);
      NAME_RUN.lastIndex = 0;
      const name = NAME_RUN.exec(tail);
      // Must sit right at the marker, not somewhere later in the title.
      if (name && name.index <= 1 && looksLikeName(name[1])) found.add(name[1]);
    }
  }

  // "Jane Doe | The Show" and "Jane Doe on why models hallucinate"
  const lead = /^\s*([A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20}){1,2})\s*(?:\||\bon\b|[-–—]\s)/.exec(title);
  if (lead && looksLikeName(lead[1])) found.add(lead[1]);

  return [...found];
}

export type MentionSource = {
  videoId: string;
  title: string;
  description: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  /** True when this video appears in watch history — weighted far higher. */
  watched: boolean;
};

export type ExtractedMention = {
  kind: "handle" | "channel" | "guest";
  value: string;
  source: MentionSource;
};

/**
 * Descriptions are where collaborators get linked; titles are where guests get
 * named. Both are already cached, so this whole pass is free.
 */
export function extractMentions(video: MentionSource): ExtractedMention[] {
  const haystack = `${video.title}\n${video.description}`;
  const out: ExtractedMention[] = [];

  for (const value of extractChannelIds(haystack)) {
    out.push({ kind: "channel", value, source: video });
  }
  for (const value of extractHandles(haystack)) {
    out.push({ kind: "handle", value, source: video });
  }
  for (const value of extractGuestNames(video.title)) {
    out.push({ kind: "guest", value, source: video });
  }
  return out;
}

/** A watched mention counts for much more than one merely sitting in the feed. */
export const WATCHED_WEIGHT = 3;
export const UNWATCHED_WEIGHT = 1;
/** Handles and explicit channel links are hard evidence; a guessed name is not. */
export const KIND_WEIGHT: Record<ExtractedMention["kind"], number> = {
  channel: 1,
  handle: 1,
  guest: 0.4,
};

export type ScoredCandidate = {
  key: string;
  kind: ExtractedMention["kind"];
  score: number;
  sources: MentionSource[];
};

/**
 * Groups mentions by target and scores them. Recency matters a little — a
 * collaborator mentioned this month is more interesting than one from 2019 —
 * but who you actually watched matters more.
 */
export function scoreMentions(
  mentions: ExtractedMention[],
  now: number = Date.now(),
): ScoredCandidate[] {
  const grouped = new Map<string, ScoredCandidate>();

  for (const mention of mentions) {
    const key = `${mention.kind}:${mention.value}`;
    let entry = grouped.get(key);
    if (!entry) {
      entry = { key: mention.value, kind: mention.kind, score: 0, sources: [] };
      grouped.set(key, entry);
    }

    // One video mentioning the same channel five times is still one signal.
    if (entry.sources.some((s) => s.videoId === mention.source.videoId)) continue;

    const ageDays = Math.max(
      0,
      (now - new Date(mention.source.publishedAt).getTime()) / 86_400_000,
    );
    const recency = 1 / (1 + ageDays / 180); // half weight at ~6 months
    const watch = mention.source.watched ? WATCHED_WEIGHT : UNWATCHED_WEIGHT;

    entry.score += watch * KIND_WEIGHT[mention.kind] * recency;
    entry.sources.push(mention.source);
  }

  return [...grouped.values()].sort((a, b) => b.score - a.score);
}

/** Plain-language explanation shown under each suggestion. */
export function buildReason(candidate: ScoredCandidate, displayName: string): string {
  const watched = candidate.sources.filter((s) => s.watched);
  const channels = [...new Set(candidate.sources.map((s) => s.channelTitle))];
  const from =
    channels.length === 1
      ? channels[0]
      : `${channels[0]} and ${channels.length - 1} other channel${channels.length > 2 ? "s" : ""}`;

  const plural = (n: number) => (n === 1 ? "video" : "videos");

  if (watched.length > 0) {
    return `Mentioned in ${watched.length} ${plural(watched.length)} by ${from} that you watched.`;
  }
  const n = candidate.sources.length;
  if (candidate.kind === "guest") {
    return `${displayName} appeared in ${n} ${plural(n)} from ${from} in your feed.`;
  }
  return `Linked from ${n} ${plural(n)} by ${from} in your feed.`;
}
