/**
 * The curated allowlist the learning assistant is allowed to recommend from.
 *
 * EDIT THIS FILE to change what the assistant can suggest. Nothing outside
 * this list is ever recommended — the assistant is handed the real playlists
 * of these channels and can only pick from them.
 *
 * `handle` is the @name from the channel's URL (youtube.com/@mitocw -> "mitocw").
 * Resolving a handle costs 1 quota unit, once, and is cached permanently.
 * Set `channelId` instead if you already know it — that costs nothing.
 *
 * `topics` are matched against what the user asks for, to decide which
 * channels' catalogues are worth fetching. Keep them broad.
 */
export type LearningChannel = {
  name: string;
  handle?: string;
  channelId?: string;
  topics: string[];
};

export const LEARNING_CHANNELS: LearningChannel[] = [
  {
    name: "Stanford Online",
    handle: "stanfordonline",
    topics: ["ai", "machine learning", "nlp", "computer science", "algorithms", "statistics", "engineering"],
  },
  {
    name: "MIT OpenCourseWare",
    handle: "mitocw",
    topics: ["mathematics", "physics", "computer science", "algorithms", "linear algebra", "calculus", "economics", "engineering"],
  },
  {
    name: "CS50",
    handle: "cs50",
    topics: ["computer science", "programming", "python", "web development", "databases", "ai", "cybersecurity"],
  },
  {
    name: "DeepLearning.AI",
    handle: "Deeplearningai",
    topics: ["deep learning", "machine learning", "ai", "nlp", "llm", "prompt engineering", "neural networks"],
  },
  {
    name: "3Blue1Brown",
    handle: "3blue1brown",
    topics: ["mathematics", "linear algebra", "calculus", "neural networks", "probability", "topology"],
  },
  {
    name: "Andrej Karpathy",
    handle: "AndrejKarpathy",
    topics: ["deep learning", "neural networks", "llm", "nlp", "transformers", "programming"],
  },
  {
    name: "StatQuest with Josh Starmer",
    handle: "statquest",
    topics: ["statistics", "machine learning", "data science", "probability"],
  },
  {
    name: "Computerphile",
    handle: "Computerphile",
    topics: ["computer science", "algorithms", "cryptography", "programming", "ai"],
  },
];

/**
 * Picks which allowlisted channels to fetch for a request. Everything is
 * fetched when nothing matches, so a vague question still gets an answer.
 */
export function channelsForQuery(query: string, limit = 5): LearningChannel[] {
  const needle = query.toLowerCase();
  const scored = LEARNING_CHANNELS.map((channel) => {
    const hits = channel.topics.filter((topic) => needle.includes(topic)).length;
    // A channel named outright always wins.
    const named = needle.includes(channel.name.toLowerCase()) ? 10 : 0;
    return { channel, score: hits + named };
  });

  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  if (matched.length === 0) return LEARNING_CHANNELS.slice(0, limit);
  return matched.slice(0, limit).map((s) => s.channel);
}
