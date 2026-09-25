import "server-only";

import { ApiError, GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { channelsForQuery, type LearningChannel } from "@/config/learning-channels";
import { PLAYLIST_TTL_MS } from "./db/courses";
import { QuotaBudgetError } from "./quota";
import {
  groundPicks,
  renderCatalogue,
  type CourseCandidate,
  type Recommendation,
} from "./assistant-core";
import type { AppContext } from "./context";

export type { CourseCandidate, Recommendation };

export const DEFAULT_MODEL = "gemini-3.8-flash";
/** Deliberately short: a handful of picks plus a paragraph of explanation. */
const MAX_TOKENS = 4000;

export class AssistantNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set, so the learning assistant is unavailable.");
  }
}

export function isAssistantConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

/** The model may only choose from playlists we actually fetched. */
const RecommendationSchema = z.object({
  reply: z
    .string()
    .describe("A short, calm reply to the learner. Two or three sentences at most."),
  picks: z
    .array(
      z.object({
        playlist_id: z
          .string()
          .describe("The exact playlist_id from the catalogue. Never invent one."),
        why: z
          .string()
          .describe("One sentence on why this course fits what the learner asked for."),
        order: z.number().describe("1 for the best starting point, then 2, 3..."),
      }),
    )
    .describe("Between one and four courses, best first. Empty if nothing fits."),
});

const RESPONSE_JSON_SCHEMA = z.toJSONSchema(RecommendationSchema);

export type AssistantAnswer = {
  reply: string;
  recommendations: Recommendation[];
  /** Playlists the model named that weren't in the catalogue. Always dropped. */
  rejected: string[];
  catalogueSize: number;
  quotaUsed: number;
  model: string;
};

/**
 * Fetches the real playlists of the allowlisted channels, using the 7-day
 * cache first. Returns only things that genuinely exist on YouTube — this is
 * what the model is grounded against.
 */
export async function buildCatalogue(
  ctx: AppContext,
  query: string,
): Promise<CourseCandidate[]> {
  const channels = channelsForQuery(query);
  const catalogue: CourseCandidate[] = [];

  for (const channel of channels) {
    const channelId = await resolveChannelId(ctx, channel);
    if (!channelId) continue;

    const cached = await ctx.courses.freshPlaylistsForChannel(channelId);
    if (cached.length > 0) {
      catalogue.push(
        ...cached.map((p) => ({
          playlistId: p.playlist_id,
          title: p.title,
          description: p.description,
          channelTitle: p.channel_title,
          channelId: p.channel_id,
          thumbnail: p.thumbnail,
          itemCount: p.item_count,
        })),
      );
      continue;
    }

    try {
      const playlists = await ctx.client.listChannelPlaylists(channelId, 50);
      await ctx.courses.upsertPlaylists(
        playlists.map((p) => ({
          playlist_id: p.playlistId,
          channel_id: p.channelId,
          channel_title: p.channelTitle,
          title: p.title,
          description: p.description,
          thumbnail: p.thumbnail,
          item_count: p.itemCount,
        })),
      );
      catalogue.push(
        ...playlists.map((p) => ({
          playlistId: p.playlistId,
          title: p.title,
          description: p.description,
          channelTitle: p.channelTitle,
          channelId: p.channelId,
          thumbnail: p.thumbnail,
          itemCount: p.itemCount,
        })),
      );
    } catch (err) {
      if (err instanceof QuotaBudgetError) break;
      // One unreachable channel shouldn't sink the whole answer.
    }
  }

  // A playlist with no videos is not a course.
  return catalogue.filter((c) => c.itemCount > 0);
}

/**
 * Allowlist entries may name a channel by handle. Resolution costs 1 unit and
 * is cached permanently — but unlike discovery, a miss here is NOT cached,
 * so fixing a typo in the config takes effect immediately.
 */
async function resolveChannelId(
  ctx: AppContext,
  channel: LearningChannel,
): Promise<string | null> {
  if (channel.channelId) return channel.channelId;
  if (!channel.handle) return null;

  const known = await ctx.discover.knownHandles([channel.handle]);
  const cached = known.get(channel.handle.toLowerCase());
  if (cached) return cached;

  try {
    const resolved = await ctx.client.getChannelByHandle(channel.handle);
    if (!resolved) return null;
    await ctx.discover.recordResolution(channel.handle, resolved.channelId);
    await ctx.videos.upsertChannels([
      {
        channel_id: resolved.channelId,
        title: resolved.title,
        handle: resolved.handle ?? channel.handle,
        description: resolved.description,
        thumbnail: resolved.thumbnail,
      },
    ]);
    return resolved.channelId;
  } catch {
    return null;
  }
}

const SYSTEM_PROMPT = `You help one person choose a course to work through on YouTube.

You will be given a CATALOGUE of real playlists that were just fetched from YouTube. These are the only courses that exist for your purposes.

Rules:
- Recommend ONLY playlists whose playlist_id appears verbatim in the catalogue. Never invent, guess, or modify a playlist_id, and never suggest a course that is not listed.
- If nothing in the catalogue fits what the learner asked for, say so plainly and return no picks. That is a correct answer, not a failure.
- Prefer a complete lecture series over a single talk when the learner wants to learn a subject.
- Order picks so the best starting point is first.
- Write plainly. No hype, no exclamation marks, no emoji. Two or three sentences of reply at most.`;

export type ChatTurn = { role: "user" | "assistant"; content: string };

export async function askAssistant(
  ctx: AppContext,
  question: string,
  history: ChatTurn[] = [],
): Promise<AssistantAnswer> {
  if (!isAssistantConfigured()) throw new AssistantNotConfiguredError();

  const before = (await ctx.ledger.status()).used;
  const catalogue = await buildCatalogue(ctx, question);
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;

  if (catalogue.length === 0) {
    return {
      reply:
        "I couldn't load any course catalogues just now — that usually means the YouTube budget is spent for today. Try again after it resets.",
      recommendations: [],
      rejected: [],
      catalogueSize: 0,
      quotaUsed: (await ctx.ledger.status()).used - before,
      model,
    };
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

  // Gemini calls the assistant role "model".
  const contents = [
    ...history.slice(-6).map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    {
      role: "user",
      parts: [{ text: `CATALOGUE\n${renderCatalogue(catalogue)}\n\nLEARNER: ${question}` }],
    },
  ];

  let parsed: z.infer<typeof RecommendationSchema> | null = null;
  try {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        maxOutputTokens: MAX_TOKENS,
        // Constrained decoding against the same schema we validate with below.
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_JSON_SCHEMA,
      },
    });

    if (response.promptFeedback?.blockReason) {
      return {
        reply: "I can't help with that particular request.",
        recommendations: [],
        rejected: [],
        catalogueSize: catalogue.length,
        quotaUsed: (await ctx.ledger.status()).used - before,
        model,
      };
    }

    // The schema constrains generation, but the response is still validated
    // here: a truncated or malformed reply must fail loudly, not half-render.
    const raw = response.text;
    if (raw) {
      const result = RecommendationSchema.safeParse(JSON.parse(raw));
      parsed = result.success ? result.data : null;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) throw new AssistantNotConfiguredError();
      if (err.status === 429) {
        throw new Error("The assistant is rate limited right now. Try again shortly.");
      }
      if (err.status === 503) {
        throw new Error("Gemini is overloaded right now. Try again in a minute.");
      }
      throw new Error(`The assistant failed (${err.status}): ${err.message}`);
    }
    if (err instanceof SyntaxError) {
      throw new Error("The assistant returned malformed JSON.");
    }
    throw err;
  }

  if (!parsed) {
    throw new Error("The assistant returned a response that did not match the schema.");
  }

  // The hard guarantee lives in groundPicks: a pick survives only if its id
  // is one we actually fetched from YouTube.
  const { recommendations, rejected } = groundPicks(parsed.picks, catalogue);

  return {
    reply: parsed.reply,
    recommendations,
    rejected,
    catalogueSize: catalogue.length,
    quotaUsed: (await ctx.ledger.status()).used - before,
    model,
  };
}
