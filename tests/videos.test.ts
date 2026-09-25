import assert from "node:assert/strict";
import test from "node:test";
import { createVideoRepo } from "../src/lib/db/videos.ts";
import { createFakeDb } from "./helpers/fakeDb.ts";

const KARPATHY = "UCXUPKJO5MZQN11PqgIvyuvQ";

function subscribedDb() {
  return createFakeDb({
    channels: [
      { channel_id: KARPATHY, title: "Andrej Karpathy", is_subscribed: true },
      { channel_id: "UCfireship", title: "Fireship", is_subscribed: true },
    ],
  });
}

test("a metadata upsert cannot unsubscribe a channel (the /learn bug)", async () => {
  const db = subscribedDb();
  const videos = createVideoRepo(db);

  // Exactly what the assistant's allowlist lookup used to write.
  await videos.upsertChannels([
    { channel_id: KARPATHY, title: "Andrej Karpathy", handle: "AndrejKarpathy", is_subscribed: false },
  ]);

  const row = db.table("channels").find((c) => c.channel_id === KARPATHY);
  assert.equal(row.is_subscribed, true, "only the subscription sync may change this flag");
  assert.equal(row.handle, "AndrejKarpathy", "the rest of the metadata still lands");
});

test("the feed still includes the channel after such an upsert", async () => {
  const db = subscribedDb();
  const videos = createVideoRepo(db);
  await videos.upsertChannels([{ channel_id: KARPATHY, is_subscribed: false }]);

  const subscribed = (await videos.subscribedChannels()).map((c) => c.channel_id);
  assert.ok(subscribed.includes(KARPATHY));
});

test("a brand-new channel from discovery or search is not subscribed", async () => {
  const db = subscribedDb();
  const videos = createVideoRepo(db);
  await videos.upsertChannels([{ channel_id: "UCstranger", title: "Stranger", is_subscribed: true }]);

  const row = db.table("channels").find((c) => c.channel_id === "UCstranger");
  assert.notEqual(row.is_subscribed, true, "an upsert cannot subscribe you either");
});

test("syncSubscriptions is what sets and clears the flag", async () => {
  const db = subscribedDb();
  const videos = createVideoRepo(db);

  // You unsubscribed from Fireship on YouTube and followed someone new.
  await videos.syncSubscriptions([
    { channelId: KARPATHY, title: "Andrej Karpathy", thumbnail: "" },
    { channelId: "UCnew", title: "New Channel", thumbnail: "" },
  ]);

  const flag = (id: string) => db.table("channels").find((c) => c.channel_id === id)?.is_subscribed;
  assert.equal(flag(KARPATHY), true);
  assert.equal(flag("UCnew"), true, "a newly followed channel is subscribed");
  assert.equal(flag("UCfireship"), false, "an unfollowed channel drops out");
});
