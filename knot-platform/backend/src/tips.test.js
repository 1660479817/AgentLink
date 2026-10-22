import assert from "node:assert/strict";
import test from "node:test";
import { loadTipSummary, tipAmount, tipIntel, TIP_MAX } from "./tips.js";

const INTEL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AUTHOR = "33333333-3333-4333-8333-333333333333";
const GIVER = "11111111-1111-4111-8111-111111111111";

function fakePool(handler) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
    return handler(sql, params);
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}

test("a tip is a positive whole number within the cap", () => {
  assert.equal(tipAmount(1), 1);
  assert.equal(tipAmount("5"), 5);
  assert.equal(tipAmount(TIP_MAX), TIP_MAX);
  for (const bad of [0, -1, 1.5, "", null, TIP_MAX + 1]) {
    assert.throws(() => tipAmount(bad), (error) => error.code === "bad_amount");
  }
});

test("a tip moves points from the reader to the author and writes one ledger row each", async () => {
  const pool = fakePool((sql, params) => {
    if (sql.includes("FROM intel i")) return { rows: [{ id: INTEL, account_id: AUTHOR }] };
    if (sql.includes("SELECT display_name")) return { rows: [{ display_name: "乙" }] };
    // Agent 的余额落在主人账上；这里给回的 wallet 就是它自己。
    if (sql.includes("COALESCE(owner_id, id)")) return { rows: [{ wallet: params[0] }] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ points_balance: 90 }] };
    if (sql.includes("FROM intel_tips t")) return { rows: [{ total: 20, count: 2, given: 20 }] };
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await tipIntel(pool, GIVER, INTEL, 5);
  assert.deepEqual(result, { amount: 5, balance: 90, total: 20, count: 2, given: 20 });

  const ledger = pool.calls.filter((call) => call.sql.includes("INSERT INTO point_ledger"));
  assert.deepEqual(ledger.map((call) => call.params), [
    [GIVER, -5, "tip", INTEL],
    [AUTHOR, 5, "tip_in", INTEL],
  ]);
  const inserted = pool.calls.find((call) => call.sql.includes("INSERT INTO intel_tips"));
  assert.deepEqual(inserted.params, [GIVER, INTEL, AUTHOR, 5]);
  assert.ok(pool.calls.some((call) => call.sql.trim() === "COMMIT"));

  // 打赏提醒落在作者名下，并链回这条信息。
  const notice = pool.calls.find((call) => call.sql.includes("INSERT INTO notifications"));
  assert.equal(notice.params[0], AUTHOR);
  assert.equal(notice.params[1], "tip");
  assert.match(notice.params[3], /乙/);
  assert.match(notice.params[3], /5/);
  assert.equal(notice.params[5], INTEL);
});

test("a failed tip rolls the transaction back", async () => {
  const pool = fakePool((sql) => (sql.includes("FROM intel i") ? { rows: [{ id: INTEL, account_id: AUTHOR }] } : { rows: [] }));
  await assert.rejects(() => tipIntel(pool, GIVER, INTEL, 5), (error) => error.message === "insufficient_points");
  assert.ok(pool.calls.some((call) => call.sql.trim() === "ROLLBACK"));
  assert.ok(!pool.calls.some((call) => call.sql.includes("INSERT INTO intel_tips")));
  assert.ok(!pool.calls.some((call) => call.sql.includes("INSERT INTO notifications")));
});

test("you cannot tip your own record", async () => {
  const pool = fakePool(() => ({ rows: [{ id: INTEL, account_id: GIVER }] }));
  await assert.rejects(() => tipIntel(pool, GIVER, INTEL, 5), (error) => error.code === "tip_self");
  assert.ok(pool.calls.some((call) => call.sql.trim() === "ROLLBACK"));
});

test("an owner cannot tip an agent that spends the same wallet", async () => {
  const pool = fakePool((sql) => {
    if (sql.includes("FROM intel i")) return { rows: [{ id: INTEL, account_id: AUTHOR }] };
    // 作者是 GIVER 名下的 Agent，两个 id 不同，但钱都记在 GIVER 这个钱包上。
    if (sql.includes("AS wallet")) return { rows: [{ wallet: GIVER }] };
    return { rows: [] };
  });
  await assert.rejects(() => tipIntel(pool, GIVER, INTEL, 5), (error) => error.code === "tip_self");
  assert.ok(pool.calls.some((call) => call.sql.trim() === "ROLLBACK"));
  assert.ok(!pool.calls.some((call) => call.sql.includes("INSERT INTO point_ledger")));
});

test("a record that is not visible cannot be tipped", async () => {
  const pool = fakePool(() => ({ rows: [] }));
  await assert.rejects(() => tipIntel(pool, GIVER, INTEL, 5), (error) => error.code === "not_found");
});

test("the tip summary counts every tip and what this account gave", async () => {
  const pool = fakePool(() => ({ rows: [{ total: 30, count: 3, given: 10 }] }));
  assert.deepEqual(await loadTipSummary(pool, GIVER, INTEL), { total: 30, count: 3, given: 10 });
  // 一条 SQL 同时算总数、笔数和自己给过的，不等记录存在再补一次查询。
  assert.equal(pool.calls.length, 1);
  assert.deepEqual(pool.calls[0].params, [INTEL, GIVER]);
});

test("a guest still gets totals, with no personal share, and a hidden record has no summary", async () => {
  const pool = fakePool(() => ({ rows: [{ total: 0, count: 0, given: 0 }] }));
  assert.deepEqual(await loadTipSummary(pool, null, INTEL), { total: 0, count: 0, given: 0 });
  assert.deepEqual(pool.calls[0].params, [INTEL, null]);

  const hidden = fakePool(() => ({ rows: [] }));
  await assert.rejects(() => loadTipSummary(hidden, null, INTEL), (error) => error.code === "not_found");
});
