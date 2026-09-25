import assert from "node:assert/strict";
import test from "node:test";
import { findRelated } from "../src/lib/related.ts";
import { parseDuration, uploadsPlaylistId } from "../src/lib/youtube.ts";
import { formatDuration, dateBucket, compactNumber } from "../src/lib/format.ts";

const v = (o: any) => ({
  id: o.id, title: o.title, description: o.description ?? "",
  channelId: o.channelId ?? "UC_a", channelTitle: o.channelTitle ?? "A",
  publishedAt: o.publishedAt ?? "2026-09-01T00:00:00Z", thumbnail: "",
  tags: o.tags,
});

test("parseDuration handles hours, minutes, seconds", () => {
  assert.equal(parseDuration("PT1H2M3S"), 3723);
  assert.equal(parseDuration("PT45S"), 45);
  assert.equal(parseDuration("PT2M"), 120);
  assert.equal(parseDuration("P1DT2H"), 93600);
  assert.equal(parseDuration(undefined), undefined);
});

test("uploads playlist id swaps the UC prefix", () => {
  assert.equal(uploadsPlaylistId("UCabc123"), "UUabc123");
});

test("formatDuration pads correctly", () => {
  assert.equal(formatDuration(61), "1:01");
  assert.equal(formatDuration(3723), "1:02:03");
  assert.equal(formatDuration(0), null);
});

test("compactNumber", () => {
  assert.equal(compactNumber(1_240_000), "1.2M");
  assert.equal(compactNumber(undefined), null);
});

test("dateBucket labels", () => {
  const now = Date.parse("2026-09-17T12:00:00Z");
  assert.equal(dateBucket("2026-09-17T06:00:00Z", now), "Today");
  assert.equal(dateBucket("2026-09-16T06:00:00Z", now), "Yesterday");
  assert.equal(dateBucket("2026-09-13T06:00:00Z", now), "This week");
  assert.equal(dateBucket("2026-09-01T06:00:00Z", now), "This month");
});

test("findRelated ranks keyword overlap above unrelated videos", () => {
  const target = v({ id: "t", title: "Sourdough starter from scratch", tags: ["baking", "sourdough", "bread"] });
  const corpus = [
    v({ id: "match", title: "Sourdough bread baking masterclass", channelId: "UC_b", channelTitle: "B", tags: ["sourdough", "bread"] }),
    v({ id: "weak", title: "Baking a birthday cake", channelId: "UC_c", channelTitle: "C", tags: ["baking"] }),
    v({ id: "none", title: "Rebuilding a diesel engine", channelId: "UC_d", channelTitle: "D", tags: ["cars", "mechanic"] }),
    v({ id: "t", title: "Sourdough starter from scratch" }),
  ];
  const out = findRelated(target as any, corpus as any, { limit: 5 });
  assert.equal(out[0].id, "match", "strongest keyword overlap should win");
  assert.ok(!out.some((x) => x.id === "t"), "the target must never appear in its own related list");
  assert.ok(!out.some((x) => x.id === "none"), "an unrelated video should score below threshold");
});

test("findRelated caps how many come from one channel", () => {
  const target = v({ id: "t", title: "Rust async runtime internals", tags: ["rust", "async"] });
  const corpus = Array.from({ length: 8 }, (_, i) =>
    v({ id: `p${i}`, title: `Rust async runtime deep dive ${i}`, channelId: "UC_spam", channelTitle: "Spam", tags: ["rust", "async"] })
  );
  const out = findRelated(target as any, corpus as any, { limit: 10, maxPerChannel: 3 });
  assert.equal(out.length, 3);
});

test("findRelated falls back to same-channel uploads when nothing matches", () => {
  const target = v({ id: "t", title: "Zzzz qqqq", channelId: "UC_a" });
  const corpus = [
    v({ id: "same", title: "Completely different topic", channelId: "UC_a" }),
    v({ id: "other", title: "Also unrelated entirely", channelId: "UC_z", channelTitle: "Z" }),
  ];
  const out = findRelated(target as any, corpus as any);
  assert.deepEqual(out.map((x) => x.id), ["same"]);
});

test("findRelated handles an empty corpus", () => {
  assert.deepEqual(findRelated(v({ id: "t", title: "x" }) as any, []), []);
});
