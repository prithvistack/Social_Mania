import type { Video } from "./types";

// Words that appear everywhere and tell us nothing about what a video is about.
const STOPWORDS = new Set(
  `a an the and or but if then than that this these those of in on at to for from by with
   about into over after before under above is are was were be been being am do does did
   doing have has had having i me my we our you your he she it its they them their what
   which who whom how why when where all any both each few more most other some such no
   nor not only own same so too very s t can will just dont should now new full official
   video vlog episode ep part pt ft feat live stream shorts short watch best top how to
   review first last day days week weeks year years time times get got make made one two
   three thing things like really actually vs`
    .split(/\s+/)
    .filter(Boolean),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter((w) => w.length >= 3 && w.length <= 24 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

/**
 * Title words carry far more signal than description prose, and tags sit in
 * between, so each field is weighted by how many times it enters the bag.
 */
function documentTerms(video: Video): string[] {
  const terms: string[] = [];
  const title = tokenize(video.title);
  for (let i = 0; i < 3; i++) terms.push(...title);
  for (const tag of video.tags ?? []) {
    const tagTerms = tokenize(tag);
    terms.push(...tagTerms, ...tagTerms);
  }
  // Only the opening of the description — the tail is links and boilerplate.
  terms.push(...tokenize(video.description.slice(0, 400)));
  return terms;
}

type Vector = Map<string, number>;

function termFrequency(terms: string[]): Vector {
  const tf: Vector = new Map();
  for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function tfidf(tf: Vector, idf: Map<string, number>): Vector {
  const vec: Vector = new Map();
  let norm = 0;
  for (const [term, count] of tf) {
    const weight = (1 + Math.log(count)) * (idf.get(term) ?? 0);
    if (weight <= 0) continue;
    vec.set(term, weight);
    norm += weight * weight;
  }
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (const [term, weight] of vec) vec.set(term, weight / norm);
  return vec;
}

function cosine(a: Vector, b: Vector): number {
  // Walk the smaller vector; both are already L2-normalised.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, weight] of small) {
    const other = large.get(term);
    if (other) sum += weight * other;
  }
  return sum;
}

export type RelatedOptions = {
  limit?: number;
  /** Stops one prolific channel from filling the entire sidebar. */
  maxPerChannel?: number;
};

/**
 * Ranks `corpus` by similarity to `target`. The corpus is the cached feed,
 * so results can only ever come from channels the user subscribes to.
 */
export function findRelated(
  target: Video,
  corpus: Video[],
  { limit = 12, maxPerChannel = 3 }: RelatedOptions = {},
): Video[] {
  const candidates = corpus.filter((v) => v.id !== target.id);
  if (candidates.length === 0) return [];

  const docs = [target, ...candidates].map(documentTerms);

  // Inverse document frequency across the whole feed.
  const docCount = new Map<string, number>();
  for (const terms of docs) {
    for (const term of new Set(terms)) {
      docCount.set(term, (docCount.get(term) ?? 0) + 1);
    }
  }
  const n = docs.length;
  const idf = new Map<string, number>();
  for (const [term, count] of docCount) {
    idf.set(term, Math.log((n + 1) / (count + 1)) + 1);
  }

  const targetVec = tfidf(termFrequency(docs[0]), idf);

  const scored = candidates.map((video, i) => {
    let score = cosine(targetVec, tfidf(termFrequency(docs[i + 1]), idf));
    // A modest nudge for the creator being watched — same-channel uploads are
    // genuinely the most related thing available, but shouldn't crowd out the rest.
    if (video.channelId === target.channelId) score = score * 1.15 + 0.02;
    return { video, score };
  });

  scored.sort((a, b) => b.score - a.score || a.video.title.localeCompare(b.video.title));

  const perChannel = new Map<string, number>();
  const picked: Video[] = [];
  for (const { video, score } of scored) {
    if (score <= 0.01) continue;
    const used = perChannel.get(video.channelId) ?? 0;
    if (used >= maxPerChannel) continue;
    perChannel.set(video.channelId, used + 1);
    picked.push(video);
    if (picked.length >= limit) break;
  }

  // Nothing matched on keywords — fall back to recent uploads from the same
  // channel so the panel is never awkwardly empty.
  if (picked.length === 0) {
    return candidates.filter((v) => v.channelId === target.channelId).slice(0, limit);
  }
  return picked;
}
