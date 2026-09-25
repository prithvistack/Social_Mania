/**
 * Turns YouTube's topic URLs and free-text tags into the short, human
 * categories used to group discoveries and the weekly digest.
 * Pure and quota-free — everything it reads is already cached.
 */

/** Wikipedia topic URL -> the label we show. */
const TOPIC_LABELS: Record<string, string> = {
  Music: "Music",
  Hip_hop_music: "Music",
  Rock_music: "Music",
  Electronic_music: "Music",
  Independent_music: "Music",
  Pop_music: "Music",
  Classical_music: "Music",
  Jazz: "Music",
  Video_game_culture: "Gaming",
  Action_game: "Gaming",
  Role_playing_game: "Gaming",
  Strategy_video_game: "Gaming",
  Sports_game: "Gaming",
  Association_football: "Football",
  Cricket: "Cricket",
  Basketball: "Basketball",
  American_football: "Football",
  Tennis: "Tennis",
  Motorsport: "Motorsport",
  Sport: "Sport",
  Knowledge: "Learning",
  Technology: "Technology",
  Computer_hardware: "Technology",
  Software: "Software",
  Science: "Science",
  Physics: "Science",
  Mathematics: "Mathematics",
  Chemistry: "Science",
  Biology: "Science",
  Medicine: "Health",
  Health: "Health",
  Business: "Business",
  Finance: "Finance",
  Economics: "Finance",
  Politics: "Politics",
  Society: "Society",
  Film: "Film & TV",
  Television_program: "Film & TV",
  Entertainment: "Entertainment",
  Humour: "Comedy",
  Food: "Food",
  Cooking: "Food",
  Tourism: "Travel",
  Vehicle: "Cars",
  Fashion: "Fashion",
  Hobby: "Hobbies",
  "Lifestyle_(sociology)": "Lifestyle",
  Physical_fitness: "Fitness",
  Pet: "Pets",
  Military: "Military",
  History: "History",
};

/**
 * Keyword fallback for when topicDetails is absent, which is common.
 * Ordered: the first match wins, so put specific before general.
 */
const KEYWORD_CATEGORIES: [string, RegExp][] = [
  ["AI", /\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|neural net(work)?s?|llms?|large language models?|transformers?|gpt|diffusion models?|nlp|reinforcement learning|rlhf|embeddings?)\b/i],
  ["Mathematics", /\b(mathematics|maths?|calculus|algebra|topology|geometry|number theory|probability|linear algebra|proof)\b/i],
  ["Cricket", /\b(cricket|ipl|test match|odi|t20|wicket|batting|bowling)\b/i],
  ["Football", /\b(football|soccer|premier league|la liga|uefa|fifa|world cup)\b/i],
  ["Programming", /\b(programming|coding|software engineering|typescript|javascript|python|rust\b|golang|compilers?|databases?|kubernetes|devops|react\b|api design)\b/i],
  ["Science", /\b(science|physics|quantum|chemistry|biology|astronomy|neuroscience|genetics|climate)\b/i],
  ["Finance", /\b(investing|stock market|finance|economics|macro|trading|startup funding|venture capital)\b/i],
  ["Music", /\b(music|album|guitar|piano|producer|remix|concert|song(writing)?)\b/i],
  ["Gaming", /\b(gameplay|speedrun|gaming|playthrough|esports|minecraft|fortnite)\b/i],
  ["Health", /\b(fitness|nutrition|workout|health|medicine|sleep|longevity)\b/i],
  ["Film & TV", /\b(film|movie|cinema|screenplay|director|tv series)\b/i],
  ["History", /\b(history|historical|ancient|medieval|world war|empire)\b/i],
  ["Business", /\b(business|entrepreneur|marketing|strategy|management|productivity)\b/i],
];

export const FALLBACK_CATEGORY = "Other";

/** Reads YouTube's topicDetails URLs, e.g. ".../wiki/Association_football". */
export function categoryFromTopicUrls(urls: string[] | undefined): string | null {
  for (const url of urls ?? []) {
    const slug = url.split("/").pop();
    if (slug && TOPIC_LABELS[slug]) return TOPIC_LABELS[slug];
  }
  return null;
}

export function categoryFromText(text: string): string | null {
  if (!text) return null;
  for (const [label, pattern] of KEYWORD_CATEGORIES) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/**
 * Topic data is authoritative when present; otherwise the title, tags and
 * description are the only signal available.
 */
export function deriveCategory(input: {
  topicCategories?: string[];
  title?: string;
  description?: string;
  tags?: string[];
}): string {
  return (
    categoryFromTopicUrls(input.topicCategories) ??
    categoryFromText(
      [input.title ?? "", (input.tags ?? []).join(" "), (input.description ?? "").slice(0, 400)]
        .join(" ")
        .trim(),
    ) ??
    FALLBACK_CATEGORY
  );
}

export type TopicProfile = { category: string; weight: number }[];

/**
 * What the user actually watches, weighted by time spent rather than clicks —
 * a 40-minute lecture says more than a 20-second bounce.
 */
export function buildTopicProfile(
  watched: { category: string; secondsWatched: number }[],
): TopicProfile {
  const totals = new Map<string, number>();
  for (const row of watched) {
    if (!row.category) continue;
    totals.set(row.category, (totals.get(row.category) ?? 0) + Math.max(0, row.secondsWatched));
  }
  return [...totals.entries()]
    .map(([category, seconds]) => ({ category, weight: seconds }))
    .sort((a, b) => b.weight - a.weight);
}

/** Orders categories so the ones the user watches most appear first. */
export function rankCategories(profile: TopicProfile, categories: string[]): string[] {
  const rank = new Map(profile.map((p, i) => [p.category, i]));
  return [...categories].sort((a, b) => {
    const ra = rank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    if (a === FALLBACK_CATEGORY) return 1;
    if (b === FALLBACK_CATEGORY) return -1;
    return a.localeCompare(b);
  });
}
