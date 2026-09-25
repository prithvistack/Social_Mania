import assert from "node:assert/strict";
import test from "node:test";
import {
  groundPicks,
  renderCatalogue,
  type CourseCandidate,
} from "../src/lib/assistant-core.ts";
import { channelsForQuery, LEARNING_CHANNELS } from "../src/config/learning-channels.ts";

const course = (id: string, title: string): CourseCandidate => ({
  playlistId: id,
  title,
  description: "A real course that was actually fetched from YouTube.",
  channelTitle: "Stanford Online",
  channelId: "UCstanford",
  thumbnail: "",
  itemCount: 19,
});

const CATALOGUE = [
  course("PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ", "CS224N: NLP with Deep Learning"),
  course("PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU", "CS229: Machine Learning"),
];

test("a hallucinated playlist id is dropped, never rendered", () => {
  const { recommendations, rejected } = groundPicks(
    [
      { playlist_id: "PLtotally-made-up", why: "Sounds relevant", order: 1 },
      { playlist_id: "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ", why: "Covers NLP", order: 2 },
    ],
    CATALOGUE,
  );

  assert.deepEqual(recommendations.map((r) => r.playlistId), [
    "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ",
  ]);
  assert.deepEqual(rejected, ["PLtotally-made-up"]);
});

test("a near-miss id is still rejected", () => {
  // One character off — exactly the kind of thing a model produces.
  const { recommendations, rejected } = groundPicks(
    [{ playlist_id: "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmX", why: "close", order: 1 }],
    CATALOGUE,
  );
  assert.equal(recommendations.length, 0);
  assert.equal(rejected.length, 1);
});

test("picks are returned in the model's stated order", () => {
  const { recommendations } = groundPicks(
    [
      { playlist_id: "PLoROMvodv4rMiGQp3WXShtMGgzqpfVfbU", why: "second", order: 2 },
      { playlist_id: "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ", why: "first", order: 1 },
    ],
    CATALOGUE,
  );
  assert.deepEqual(recommendations.map((r) => r.why), ["first", "second"]);
});

test("a duplicated pick appears once", () => {
  const { recommendations } = groundPicks(
    [
      { playlist_id: "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ", why: "a", order: 1 },
      { playlist_id: "PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ", why: "b", order: 2 },
    ],
    CATALOGUE,
  );
  assert.equal(recommendations.length, 1);
});

test("an empty pick list is a valid answer, not an error", () => {
  const { recommendations, rejected } = groundPicks([], CATALOGUE);
  assert.deepEqual(recommendations, []);
  assert.deepEqual(rejected, []);
});

test("nothing survives when the catalogue is empty", () => {
  const { recommendations, rejected } = groundPicks(
    [{ playlist_id: "PLanything", why: "x", order: 1 }],
    [],
  );
  assert.equal(recommendations.length, 0);
  assert.deepEqual(rejected, ["PLanything"]);
});

test("the rendered catalogue carries real ids and nothing else", () => {
  const rendered = renderCatalogue(CATALOGUE);
  assert.match(rendered, /playlist_id: PLoROMvodv4rOSH4v6133s9LFPRHjEmbmJ/);
  assert.match(rendered, /CS224N/);
  assert.equal(rendered.split("playlist_id:").length - 1, 2);
});

test("channel selection matches the topic asked about", () => {
  const nlp = channelsForQuery("I want to learn NLP").map((c) => c.name);
  assert.ok(nlp.includes("Stanford Online") || nlp.includes("DeepLearning.AI"));

  const maths = channelsForQuery("teach me linear algebra").map((c) => c.name);
  assert.ok(maths.includes("3Blue1Brown") || maths.includes("MIT OpenCourseWare"));
});

test("naming a channel outright puts it first", () => {
  const picked = channelsForQuery("something from MIT OpenCourseWare");
  assert.equal(picked[0].name, "MIT OpenCourseWare");
});

test("a vague question still returns channels to search", () => {
  const picked = channelsForQuery("i want to learn something new");
  assert.ok(picked.length > 0);
});

test("every allowlist entry is addressable", () => {
  for (const channel of LEARNING_CHANNELS) {
    assert.ok(
      channel.channelId || channel.handle,
      `${channel.name} needs either a channelId or a handle`,
    );
    assert.ok(channel.topics.length > 0, `${channel.name} needs topics`);
  }
});
