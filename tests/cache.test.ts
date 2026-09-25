import assert from "node:assert/strict";
import test from "node:test";
import { Store } from "../src/lib/cache.ts";

const unique = () => `k${Math.random().toString(36).slice(2)}`;

test("a fresh value is served without refetching", async () => {
  const store = new Store<number>(unique(), 60);
  let loads = 0;
  const load = async () => ++loads;

  assert.equal((await store.resolve("a", load)).value, 1);
  assert.equal((await store.resolve("a", load)).value, 1);
  assert.equal(loads, 1);
});

test("an expired value is refetched", async () => {
  const store = new Store<number>(unique(), 0.05);
  let loads = 0;
  const load = async () => ++loads;

  await store.resolve("a", load);
  await new Promise((r) => setTimeout(r, 90));
  const second = await store.resolve("a", load);

  assert.equal(second.value, 2);
  assert.equal(second.fresh, true);
});

test("force bypasses a fresh value", async () => {
  const store = new Store<number>(unique(), 60);
  let loads = 0;
  const load = async () => ++loads;

  await store.resolve("a", load);
  assert.equal((await store.resolve("a", load, { force: true })).value, 2);
});

test("concurrent callers share a single fetch", async () => {
  const store = new Store<number>(unique(), 60);
  let loads = 0;
  const load = async () => {
    loads++;
    await new Promise((r) => setTimeout(r, 30));
    return loads;
  };

  const results = await Promise.all([
    store.resolve("a", load),
    store.resolve("a", load),
    store.resolve("a", load),
  ]);

  assert.equal(loads, 1, "three simultaneous readers must not trigger three API refreshes");
  assert.deepEqual(results.map((r) => r.value), [1, 1, 1]);
});

test("a stale value survives a failing refetch", async () => {
  const store = new Store<string>(unique(), 0.05);
  await store.resolve("a", async () => "good");
  await new Promise((r) => setTimeout(r, 90));

  const result = await store.resolve("a", async () => {
    throw new Error("YouTube is down");
  });

  assert.equal(result.value, "good", "an outage should not blank the feed");
  assert.equal(result.fresh, false, "but it is reported as stale");
});

test("a failing first load with nothing cached rejects", async () => {
  const store = new Store<string>(unique(), 60);
  await assert.rejects(() => store.resolve("a", async () => { throw new Error("boom"); }));
});

test("invalidate forces the next read to refetch", async () => {
  const store = new Store<number>(unique(), 60);
  let loads = 0;
  const load = async () => ++loads;

  await store.resolve("a", load);
  await store.invalidate("a");
  assert.equal((await store.resolve("a", load)).value, 2);
});

test("a value written by one Store instance is readable by another", async () => {
  const ns = unique();
  const a = new Store<string>(ns, 60);
  await a.resolve("shared", async () => "from-disk");

  // Simulates a warm lambda picking up a fresh module instance.
  const b = new Store<string>(ns, 60);
  const result = await b.resolve("shared", async () => "refetched");

  assert.equal(result.value, "from-disk");
});

test("invalidate leaves nothing readable behind", async () => {
  const ns = unique();
  const store = new Store<{ items: number[] }>(ns, 60);
  await store.resolve("a", async () => ({ items: [1, 2] }));
  await store.invalidate("a");

  // A fresh instance has an empty memory tier, so this reads the mirror file
  // and must find nothing rather than an entry holding null.
  assert.equal(await new Store<{ items: number[] }>(ns, 60).peek("a"), null);
});
