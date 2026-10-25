import assert from "node:assert/strict";
import { describe, test } from "node:test";
import express from "express";
import { applyPriceProposal, loadEconomyPolicy, parsePriceSchedule, priceSchedule, proposePrices } from "./actuary.js";
import { adminRouter } from "./routes/admin.js";
import { clearPriceOverride, economyConfig, installPriceOverride } from "./points.js";

const NEXT = {
  defaultPrice: 12,
  priceMin: 0,
  priceMax: 80,
  publishServiceFeePerMb: 1,
  serviceFeeCap: 10,
  pointUsdCents: 1,
};

function memoryPool() {
  const proposals = [];
  let policy = null;
  let seq = 0;
  const columns = [
    "default_price",
    "price_min",
    "price_max",
    "publish_service_fee_per_mb",
    "service_fee_cap",
    "point_usd_cents",
  ];
  async function query(sql, params = []) {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("SET status = 'withdrawn'")) {
      for (const row of proposals) if (row.status === "pending") row.status = "withdrawn";
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO price_proposals")) {
      seq += 1;
      const row = {
        id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${seq}`,
        status: "pending",
        created_at: "2026-10-16T03:00:00.000Z",
        applied_at: null,
      };
      columns.forEach((column, index) => {
        row[column] = params[index];
      });
      proposals.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }
    if (sql.includes("FROM price_proposals WHERE id")) {
      const row = proposals.find((item) => item.id === params[0]);
      return { rows: row ? [row] : [] };
    }
    if (sql.includes("status = 'pending'")) {
      return { rows: proposals.filter((item) => item.status === "pending") };
    }
    if (sql.includes("INSERT INTO economy_policy")) {
      policy = { id: 1, proposal_id: params[6] };
      columns.forEach((column, index) => {
        policy[column] = params[index];
      });
      return { rows: [] };
    }
    if (sql.includes("SET status = 'applied'")) {
      const row = proposals.find((item) => item.id === params[0]);
      if (row) row.status = "applied";
      return { rows: [] };
    }
    if (sql.includes("FROM economy_policy")) {
      return { rows: policy ? [policy] : [] };
    }
    throw new Error(`unexpected sql: ${sql}`);
  }
  const client = {
    query,
    release() {},
  };
  return {
    proposals,
    pool: {
      async connect() {
        return client;
      },
      query,
    },
  };
}

describe("price schedule", { concurrency: false }, () => {
test("a price schedule is six whole numbers, with the default inside the range", () => {
  assert.deepEqual(parsePriceSchedule({ ...NEXT, defaultPrice: 0, priceMax: 0, publishServiceFeePerMb: 0 }), {
    ...NEXT,
    defaultPrice: 0,
    priceMax: 0,
    publishServiceFeePerMb: 0,
  });
  assert.equal(parsePriceSchedule({ ...NEXT, defaultPrice: "12" }).defaultPrice, 12);
  for (const body of [{}, { ...NEXT, defaultPrice: 81 }, { ...NEXT, priceMax: 1, priceMin: 2 }, { ...NEXT, publishServiceFeePerMb: 1001 }, { ...NEXT, pointUsdCents: -1 }, { ...NEXT, serviceFeeCap: 1.5 }]) {
    assert.throws(() => parsePriceSchedule(body), (error) => error.code === "bad_price");
  }
});

test("a written schedule replaces the price keys and leaves the grant alone", () => {
  const before = economyConfig();
  installPriceOverride({ ...NEXT, defaultPrice: 40 });
  try {
    const after = economyConfig();
    assert.equal(after.defaultPrice, 40);
    assert.equal(after.priceMax, 80);
    assert.equal(after.publishServiceFeePerMb, 1);
    assert.equal(after.signupGrant, before.signupGrant);
    assert.equal(after.grantMax, before.grantMax);
    assert.equal(after.monthlyOpexUsd, before.monthlyOpexUsd);
  } finally {
    clearPriceOverride();
  }
  assert.equal(economyConfig().defaultPrice, before.defaultPrice);
});

test("proposing replaces the pending schedule, and only that proposal can be applied", async () => {
  clearPriceOverride();
  const liveBefore = economyConfig().defaultPrice;
  const store = memoryPool();
  const first = await proposePrices(store.pool, NEXT);
  const second = await proposePrices(store.pool, { ...NEXT, defaultPrice: 20 });
  assert.equal(store.proposals[0].status, "withdrawn");
  assert.equal(store.proposals[1].status, "pending");
  assert.equal(store.proposals[1].default_price, 20);
  assert.equal(economyConfig().defaultPrice, liveBefore);

  const reading = await priceSchedule(store.pool);
  assert.equal(reading.source, "env");
  assert.equal(reading.pending.id, second.proposal.id);

  const applied = await applyPriceProposal(store.pool, second.proposal.id);
  assert.equal(applied.source, "policy");
  assert.equal(applied.prices.defaultPrice, 20);
  assert.equal(economyConfig().defaultPrice, 20);
  assert.equal(store.proposals[1].status, "applied");
  assert.equal((await priceSchedule(store.pool)).pending, null);
  assert.equal((await priceSchedule(store.pool)).source, "policy");

  await assert.rejects(applyPriceProposal(store.pool, first.proposal.id), (error) => error.code === "not_pending");
  await assert.rejects(applyPriceProposal(store.pool, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa99"), (error) => error.code === "not_found");
  await assert.rejects(applyPriceProposal(store.pool, "nope"), (error) => error.code === "not_found");
  clearPriceOverride();
});

test("startup loads a written schedule and clears it when the table is empty", async () => {
  const store = memoryPool();
  assert.equal(await loadEconomyPolicy(store.pool), null);
  await proposePrices(store.pool, NEXT);
  const { proposal } = await proposePrices(store.pool, { ...NEXT, serviceFeeCap: 8 });
  await applyPriceProposal(store.pool, proposal.id);
  clearPriceOverride();
  const loaded = await loadEconomyPolicy(store.pool);
  assert.equal(loaded.serviceFeeCap, 8);
  assert.equal(economyConfig().serviceFeeCap, 8);
  clearPriceOverride();
});

test("the admin door accepts a proposal and applies it on the loopback", async () => {
  clearPriceOverride();
  const store = memoryPool();
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: store.pool, token: "secret" }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  try {
    const port = server.address().port;
    const headers = { Authorization: "Bearer secret", "Content-Type": "application/json" };
    const proposed = await fetch(`http://127.0.0.1:${port}/api/admin/prices/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify(NEXT),
    });
    assert.equal(proposed.status, 201);
    const { proposal } = await proposed.json();
    const rejected = await fetch(`http://127.0.0.1:${port}/api/admin/prices/proposals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...NEXT, defaultPrice: 500 }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "bad_price" });
    const applied = await fetch(`http://127.0.0.1:${port}/api/admin/prices/proposals/${proposal.id}/apply`, {
      method: "POST",
      headers,
    });
    assert.equal(applied.status, 200);
    assert.equal((await applied.json()).prices.publishServiceFeePerMb, 1);
    assert.equal(economyConfig().publishServiceFeePerMb, 1);
    const again = await fetch(`http://127.0.0.1:${port}/api/admin/prices/proposals/${proposal.id}/apply`, {
      method: "POST",
      headers,
    });
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { error: "not_pending" });
  } finally {
    server.close();
    clearPriceOverride();
  }
});
});
