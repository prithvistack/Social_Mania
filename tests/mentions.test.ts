import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReason,
  extractChannelIds,
  extractGuestNames,
  extractHandles,
  extractMentions,
  scoreMentions,
  type MentionSource,
} from "../src/lib/mentions.ts";

test("bare @handles are extracted and lowercased", () => {
  assert.deepEqual(extractHandles("Thanks to @Veritasium and @3blue1brown!"), [
    "veritasium",
    "3blue1brown",
  ]);
});

test("handle URLs are extracted", () => {
  const text = "Guest: https://www.youtube.com/@lexfridman and youtube.com/@AndrejKarpathy";
  assert.deepEqual(extractHandles(text).sort(), ["andrejkarpathy", "lexfridman"]);
});

test("email addresses are not mistaken for handles", () => {
  assert.deepEqual(extractHandles("Business: hello@example.com, press@studio.co.uk"), []);
});

test("timestamps and prices after an @ are ignored", () => {
  assert.deepEqual(extractHandles("Deal @ 12:34 and @ $9.99"), []);
});

test("trailing punctuation is stripped from a handle", () => {
  assert.deepEqual(extractHandles("Go sub to @mkbhd, seriously."), ["mkbhd"]);
  assert.deepEqual(extractHandles("(see @waveform)"), ["waveform"]);
});

test("handles shorter than 3 characters are rejected", () => {
  assert.deepEqual(extractHandles("@ab is too short but @abc is fine"), ["abc"]);
});

test("duplicate handles collapse to one", () => {
  assert.deepEqual(extractHandles("@same @same @SAME"), ["same"]);
});

test("channel URLs are extracted", () => {
  const text = "More at https://www.youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw today";
  assert.deepEqual(extractChannelIds(text), ["UCYO_jab_esuFRV4b17AJtAw"]);
});

test("a non-UC path is not treated as a channel id", () => {
  assert.deepEqual(extractChannelIds("youtube.com/channel/XXnotachannel"), []);
});

test("guest names are taken from explicit markers", () => {
  assert.deepEqual(extractGuestNames("Deep dive with Andrej Karpathy"), ["Andrej Karpathy"]);
  assert.deepEqual(extractGuestNames("Scaling laws ft. Jared Kaplan"), ["Jared Kaplan"]);
  assert.deepEqual(extractGuestNames("Interview with Sara Hooker"), ["Sara Hooker"]);
});

test("the leading 'Name | Show' slot is recognised", () => {
  assert.deepEqual(extractGuestNames("Sholto Douglas | The Lunar Society"), ["Sholto Douglas"]);
  assert.deepEqual(extractGuestNames("Trenton Bricken on interpretability"), ["Trenton Bricken"]);
});

test("episode-number prefixes are handled", () => {
  assert.deepEqual(extractGuestNames("Ep 42: Dario Amodei on scaling"), ["Dario Amodei"]);
});

test("ordinary titles do not produce phantom guests", () => {
  assert.deepEqual(extractGuestNames("How Large Language Models Work"), []);
  assert.deepEqual(extractGuestNames("Building A Neural Network From Scratch"), []);
  assert.deepEqual(extractGuestNames("The Best Podcast Episode Ever"), []);
});

const src = (o: Partial<MentionSource> = {}): MentionSource => ({
  videoId: o.videoId ?? "v1",
  title: o.title ?? "",
  description: o.description ?? "",
  channelId: o.channelId ?? "UChost",
  channelTitle: o.channelTitle ?? "Dwarkesh Patel",
  publishedAt: o.publishedAt ?? "2026-09-01T00:00:00Z",
  watched: o.watched ?? false,
});

test("extractMentions pulls handles, channels and guests together", () => {
  const video = src({
    title: "Scaling with Andrej Karpathy",
    description: "Sub to @karpathy — youtube.com/channel/UCYO_jab_esuFRV4b17AJtAw",
  });
  const kinds = extractMentions(video).map((m) => `${m.kind}:${m.value}`);
  assert.ok(kinds.includes("handle:karpathy"));
  assert.ok(kinds.includes("channel:UCYO_jab_esuFRV4b17AJtAw"));
  assert.ok(kinds.includes("guest:Andrej Karpathy"));
});

test("a watched mention outweighs an unwatched one", () => {
  const now = Date.parse("2026-09-10T00:00:00Z");
  const scored = scoreMentions(
    [
      { kind: "handle", value: "watched", source: src({ videoId: "a", watched: true }) },
      { kind: "handle", value: "skipped", source: src({ videoId: "b", watched: false }) },
    ],
    now,
  );
  assert.equal(scored[0].key, "watched");
  assert.ok(scored[0].score > scored[1].score * 2.5);
});

test("the same channel mentioned repeatedly in one video counts once", () => {
  const source = src({ videoId: "same" });
  const scored = scoreMentions([
    { kind: "handle", value: "x", source },
    { kind: "handle", value: "x", source },
    { kind: "handle", value: "x", source },
  ]);
  assert.equal(scored.length, 1);
  assert.equal(scored[0].sources.length, 1);
});

test("older mentions are discounted", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");
  const scored = scoreMentions(
    [
      { kind: "handle", value: "recent", source: src({ videoId: "a", publishedAt: "2026-08-25T00:00:00Z" }) },
      { kind: "handle", value: "ancient", source: src({ videoId: "b", publishedAt: "2020-01-01T00:00:00Z" }) },
    ],
    now,
  );
  assert.equal(scored[0].key, "recent");
});

test("a guessed guest name scores below a hard handle link", () => {
  const now = Date.parse("2026-09-10T00:00:00Z");
  const scored = scoreMentions(
    [
      { kind: "guest", value: "Some Person", source: src({ videoId: "a" }) },
      { kind: "handle", value: "someperson", source: src({ videoId: "b" }) },
    ],
    now,
  );
  assert.equal(scored[0].kind, "handle");
});

test("reasons read as plain language", () => {
  const scored = scoreMentions([
    { kind: "handle", value: "x", source: src({ videoId: "a", watched: true }) },
    { kind: "handle", value: "x", source: src({ videoId: "b", watched: true }) },
    { kind: "handle", value: "x", source: src({ videoId: "c", watched: true }) },
  ]);
  assert.equal(
    buildReason(scored[0], "Some Channel"),
    "Mentioned in 3 videos by Dwarkesh Patel that you watched.",
  );
});

test("an unwatched reason says so without claiming you watched it", () => {
  const scored = scoreMentions([
    { kind: "handle", value: "x", source: src({ videoId: "a", watched: false }) },
  ]);
  const reason = buildReason(scored[0], "Some Channel");
  assert.match(reason, /Linked from 1 video by Dwarkesh Patel in your feed\./);
  assert.doesNotMatch(reason, /watched/);
});
