import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DAILY_BUDGET,
  QUOTA_COSTS,
  QuotaBudgetError,
  budgetDecision,
  createQuotaLedger,
  pacificDayStart,
} from "../src/lib/quota.ts";
import { createFakeDb } from "./helpers/fakeDb.ts";

test("documented unit costs match Google's table", () => {
  assert.equal(QUOTA_COSTS["videos.list"], 1);
  assert.equal(QUOTA_COSTS["channels.list"], 1);
  assert.equal(QUOTA_COSTS["subscriptions.list"], 1);
  assert.equal(QUOTA_COSTS["search.list"], 100);
  assert.equal(DEFAULT_DAILY_BUDGET, 8000);
});

test("pacificDayStart lands on midnight Pacific, not UTC", () => {
  // 2026-07-15 06:00 UTC is 2026-07-14 23:00 PDT — still the previous day.
  const start = pacificDayStart(new Date("2026-07-15T06:00:00Z"));
  assert.equal(start.toISOString(), "2026-07-14T07:00:00.000Z"); // 00:00 PDT

  // 2026-07-15 08:00 UTC is 01:00 PDT, so the day has rolled over.
  const after = pacificDayStart(new Date("2026-07-15T08:00:00Z"));
  assert.equal(after.toISOString(), "2026-07-15T07:00:00.000Z");
});

test("pacificDayStart handles standard time (UTC-8)", () => {
  const start = pacificDayStart(new Date("2026-01-15T12:00:00Z"));
  assert.equal(start.toISOString(), "2026-01-15T08:00:00.000Z"); // 00:00 PST
});

test("budgetDecision refuses anything that would exceed the budget", () => {
  assert.equal(budgetDecision({ used: 7999, requested: 1, budget: 8000 }).allowed, true);
  assert.equal(budgetDecision({ used: 8000, requested: 1, budget: 8000 }).allowed, false);
  assert.equal(
    budgetDecision({ used: 7950, requested: 100, budget: 8000 }).allowed,
    false,
    "a 100-unit search must not be allowed to overshoot",
  );
});

test("the reserve is closed to background work but open to interactive calls", () => {
  const args = { used: 7600, requested: 100, budget: 8000, reserve: 500 };
  assert.equal(budgetDecision({ ...args }).allowed, false, "background is refused");
  assert.equal(
    budgetDecision({ ...args, interactive: true }).allowed,
    true,
    "an explicit search may use the reserve",
  );
});

test("spend runs the call and logs its cost", async () => {
  const db = createFakeDb();
  const ledger = createQuotaLedger(db);

  const result = await ledger.spend("videos.list", async () => "payload");
  assert.equal(result, "payload");

  const log = db.table("quota_log");
  assert.equal(log.length, 1);
  assert.equal(log[0].endpoint, "videos.list");
  assert.equal(log[0].units, 1);
  assert.equal(log[0].outcome, "ok");
  assert.ok(!Number.isNaN(Date.parse(log[0].created_at)));
});

test("usage accumulates and is reported against the budget", async () => {
  const db = createFakeDb();
  const ledger = createQuotaLedger(db, { budget: 1000 });

  await ledger.spend("videos.list", async () => null);
  await ledger.spend("search.list", async () => null, { interactive: true });

  const status = await ledger.status();
  assert.equal(status.used, 101);
  assert.equal(status.budget, 1000);
  assert.equal(status.remaining, 899);
  assert.equal(status.percent, 10);
});

test("a refused call is logged at zero units and never runs", async () => {
  const db = createFakeDb({
    quota_log: [{ endpoint: "seed", units: 995, outcome: "ok", created_at: new Date().toISOString() }],
  });
  const ledger = createQuotaLedger(db, { budget: 1000, reserve: 0 });

  let ran = false;
  await assert.rejects(
    () => ledger.spend("search.list", async () => { ran = true; return null; }),
    QuotaBudgetError,
  );
  assert.equal(ran, false, "the API call must not be made");

  const refusal = db.table("quota_log").at(-1);
  assert.equal(refusal.outcome, "refused");
  assert.equal(refusal.units, 0, "a refusal costs nothing");
});

test("a failing call is still billed, because Google charges for it", async () => {
  const db = createFakeDb();
  const ledger = createQuotaLedger(db);

  await assert.rejects(() =>
    ledger.spend("videos.list", async () => {
      throw new Error("500 from YouTube");
    }),
  );

  const row = db.table("quota_log").at(-1);
  assert.equal(row.outcome, "error");
  assert.equal(row.units, 1, "under-counting failures is what causes overruns");
  assert.match(row.detail, /500 from YouTube/);
});

test("only calls from the current Pacific day count toward usage", async () => {
  const now = new Date("2026-07-15T20:00:00Z"); // 13:00 PDT
  const yesterday = new Date("2026-07-14T20:00:00Z");
  const db = createFakeDb({
    quota_log: [
      { endpoint: "old", units: 7000, outcome: "ok", created_at: yesterday.toISOString() },
      { endpoint: "today", units: 42, outcome: "ok", created_at: now.toISOString() },
    ],
  });
  const ledger = createQuotaLedger(db, { budget: 8000, now: () => now });

  assert.equal(await ledger.usedToday(), 42, "yesterday's spend must not count");
});

test("canSpend reports the degrade-to-cache signal without making a call", async () => {
  const db = createFakeDb({
    quota_log: [{ endpoint: "seed", units: 7990, outcome: "ok", created_at: new Date().toISOString() }],
  });
  const ledger = createQuotaLedger(db, { budget: 8000, reserve: 0 });

  assert.equal(await ledger.canSpend("videos.list"), true, "1 unit still fits");
  assert.equal(await ledger.canSpend("search.list"), false, "100 units do not");
  assert.equal(db.table("quota_log").length, 1, "checking costs nothing and logs nothing");
});

test("usage still totals correctly when the rpc helper is unavailable", async () => {
  const db = createFakeDb();
  const ledger = createQuotaLedger(db);
  await ledger.spend("videos.list", async () => null);

  db.rpcBroken = true;
  assert.equal(await ledger.usedToday(), 1, "falls back to scanning quota_log");
});

test("a logging failure never breaks the underlying call", async () => {
  const db = createFakeDb();
  const broken = {
    ...db,
    from: (t: string) => (t === "quota_log" ? { insert: () => { throw new Error("db down"); } } : db.from(t)),
  };
  const ledger = createQuotaLedger(broken as any);

  assert.equal(await ledger.spend("videos.list", async () => "still works"), "still works");
});
