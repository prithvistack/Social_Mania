import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPLETE_FRACTION,
  DERIVED_STATE_KEYS,
  createHistoryRepo,
  createWatchLaterRepo,
} from "../src/lib/db/history.ts";
import { createFakeDb } from "./helpers/fakeDb.ts";

const NOW = new Date("2026-09-20T12:00:00Z");
const at = (iso: string) => new Date(iso);

/** A database already carrying history plus everything derived from it. */
function seeded() {
  return createFakeDb({
    watch_history: [
      { id: 1, video_id: "vA", channel_id: "UC1", watched_at: "2026-09-01T10:00:00Z", seconds_watched: 600, completed: true },
      { id: 2, video_id: "vB", channel_id: "UC2", watched_at: "2026-09-10T10:00:00Z", seconds_watched: 300, completed: false },
      { id: 3, video_id: "vC", channel_id: "UC1", watched_at: "2026-09-18T10:00:00Z", seconds_watched: 900, completed: true },
      { id: 4, video_id: "vA", channel_id: "UC1", watched_at: "2026-09-19T10:00:00Z", seconds_watched: 120, completed: false },
    ],
    playback_positions: [
      { video_id: "vA", position_seconds: 120, duration_seconds: 1200, updated_at: "2026-09-19T10:00:00Z" },
      { video_id: "vB", position_seconds: 300, duration_seconds: 1800, updated_at: "2026-09-10T10:00:00Z" },
      { video_id: "vC", position_seconds: 900, duration_seconds: 1000, updated_at: "2026-09-18T10:00:00Z" },
    ],
    discovered_channels: [
      { channel_id: "UCnew", dismissed: false, reason: "Mentioned in 2 videos you watched." },
      { channel_id: "UChidden", dismissed: true, reason: "Mentioned once." },
    ],
    app_state: [
      { key: "topic_profile", value: { ai: 12 } },
      { key: "discover:last_run", value: { at: "2026-09-19T00:00:00Z" } },
      { key: "unrelated", value: { keep: true } },
    ],
  });
}

test("progress is recorded with a resume point", async () => {
  const db = createFakeDb();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.recordProgress({
    videoId: "v1", channelId: "UC1",
    positionSeconds: 305, secondsWatched: 305, durationSeconds: 1200,
  });

  const history = db.table("watch_history");
  assert.equal(history.length, 1);
  assert.equal(history[0].video_id, "v1");
  assert.equal(history[0].completed, false);

  const pos = db.table("playback_positions");
  assert.equal(pos[0].position_seconds, 305);
});

test("a video watched past 90% is marked complete", async () => {
  const db = createFakeDb();
  const repo = createHistoryRepo(db, () => NOW);
  await repo.recordProgress({
    videoId: "v1", channelId: "UC1",
    positionSeconds: 1000 * COMPLETE_FRACTION + 1, secondsWatched: 901, durationSeconds: 1000,
  });
  assert.equal(db.table("watch_history")[0].completed, true);
});

test("the resume point is cleared once a video is ~95% done", async () => {
  const db = createFakeDb({
    playback_positions: [{ video_id: "v1", position_seconds: 100, duration_seconds: 1000 }],
  });
  const repo = createHistoryRepo(db, () => NOW);

  await repo.recordProgress({
    videoId: "v1", channelId: "UC1",
    positionSeconds: 960, secondsWatched: 960, durationSeconds: 1000,
  });

  assert.equal(db.table("playback_positions").length, 0, "nothing left to resume");
});

test("a two-second glance is not written to history", async () => {
  const db = createFakeDb();
  const repo = createHistoryRepo(db, () => NOW);
  await repo.recordProgress({
    videoId: "v1", channelId: "UC1",
    positionSeconds: 2, secondsWatched: 2, durationSeconds: 1200,
  });
  assert.equal(db.table("watch_history").length, 0);
});

test("repeated pings in one sitting update one row instead of piling up", async () => {
  const db = createFakeDb();
  const repo = createHistoryRepo(db, () => NOW);
  const ping = (secs: number) =>
    repo.recordProgress({
      videoId: "v1", channelId: "UC1",
      positionSeconds: secs, secondsWatched: secs, durationSeconds: 1200,
    });

  await ping(30);
  await ping(90);
  await ping(150);

  const rows = db.table("watch_history");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].seconds_watched, 150, "keeps the furthest progress");
});

// --- deletion cascade -------------------------------------------------------

test("deleting one entry removes it and clears derived data", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.deleteEntry(2);

  assert.deepEqual(
    db.table("watch_history").map((r) => r.id).sort(),
    [1, 3, 4],
  );
  assert.equal(
    db.table("discovered_channels").filter((r) => !r.dismissed).length,
    0,
    "discover reasons built from history must not survive it",
  );
  assert.deepEqual(
    db.table("app_state").map((r) => r.key),
    ["unrelated"],
    "the topic profile and discovery timestamp are cleared, unrelated state is not",
  );
});

test("deleting an entry drops the resume point once nothing is left for that video", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.deleteEntry(2); // vB's only history row

  const ids = db.table("playback_positions").map((r) => r.video_id).sort();
  assert.deepEqual(ids, ["vA", "vC"], "vB's resume point is gone with its history");
});

test("a resume point survives while the video still has other history rows", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.deleteEntry(4); // one of vA's two rows

  assert.ok(
    db.table("playback_positions").some((r) => r.video_id === "vA"),
    "vA is still in history, so its resume point stays",
  );
});

test("deleting a date range removes exactly that window", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  const removed = await repo.deleteRange("2026-09-09T00:00:00Z", "2026-09-18T23:59:59Z");

  assert.equal(removed, 2, "vB and vC fall inside the range");
  assert.deepEqual(db.table("watch_history").map((r) => r.id).sort(), [1, 4]);
  assert.equal(db.table("app_state").length, 1, "derived state cleared");
});

test("a range delete leaves resume points for videos still in history", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.deleteRange("2026-09-09T00:00:00Z", "2026-09-18T23:59:59Z");

  const ids = db.table("playback_positions").map((r) => r.video_id).sort();
  assert.deepEqual(ids, ["vA"], "vB and vC are fully gone; vA still has row 4");
});

test("clear all empties history, every resume point, and all derived data", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.clearAll();

  assert.deepEqual(db.table("watch_history"), []);
  assert.deepEqual(db.table("playback_positions"), []);
  assert.equal(db.table("discovered_channels").filter((r) => !r.dismissed).length, 0);
  assert.deepEqual(db.table("app_state").map((r) => r.key), ["unrelated"]);
});

test("a dismissed discovery stays dismissed after clearing history", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);

  await repo.clearAll();

  // Otherwise every clear would resurrect channels already rejected.
  assert.deepEqual(
    db.table("discovered_channels").map((r) => r.channel_id),
    ["UChidden"],
  );
});

test("every derived key the cascade clears is declared in one place", () => {
  assert.deepEqual([...DERIVED_STATE_KEYS], ["topic_profile", "discover:last_run"]);
});

test("completedVideoIds reflects only finished videos", async () => {
  const db = seeded();
  const repo = createHistoryRepo(db, () => NOW);
  const done = await repo.completedVideoIds();
  assert.deepEqual([...done].sort(), ["vA", "vC"]);
});

// --- watch later ------------------------------------------------------------

test("watch later toggles on and off", async () => {
  const db = createFakeDb();
  const repo = createWatchLaterRepo(db, () => NOW);

  assert.equal(await repo.toggle("v1"), true);
  assert.deepEqual(db.table("watch_later").map((r) => r.video_id), ["v1"]);

  assert.equal(await repo.toggle("v1"), false);
  assert.deepEqual(db.table("watch_later"), []);
});

test("adding the same video twice does not duplicate it", async () => {
  const db = createFakeDb();
  const repo = createWatchLaterRepo(db, () => NOW);
  await repo.add("v1");
  await repo.add("v1");
  assert.equal(db.table("watch_later").length, 1);
});
