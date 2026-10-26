import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AGENT_REVIEW_SQL,
  agentReviewSnapshot,
  patrolFacts,
  reviewWindow,
} from "./agentReview.js";

// 假连接池：只按 SQL 特征回行，不连库。每个用例一个池，
// 因为缓存按池分——共用池会让上一条用例的结果漏到下一题。
function poolOf({ review, errors = [], patrol, fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (fail) throw new Error(fail);
      if (sql.includes("percentile_cont")) return { rows: [review || {}] };
      if (sql.includes("reviewError")) return { rows: errors };
      if (sql.includes("admin_actions")) return { rows: [patrol || {}] };
      throw new Error(`unexpected ${sql}`);
    },
  };
}

test("空库返回一行 null，而不是零行", async () => {
  const pool = poolOf({
    review: { last_success_at: null, pending_count: 0, pending_oldest: null, gave_up: 0, p50: null, p95: null },
    patrol: { last_at: null, today: 0 },
  });
  const snapshot = await agentReviewSnapshot(pool, { now: 1_700_000_000_000 });
  // 读到了表，所以 0 是事实；读不到的数才是 null。
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.lastSuccessAt, null);
  assert.deepEqual(snapshot.pending, { count: 0, oldestMinutes: null });
  assert.equal(snapshot.gaveUp, 0);
  assert.deepEqual(snapshot.latencySeconds, { p50: null, p95: null, settled: 0, timed: 0 });
  assert.deepEqual(snapshot.errors24h, []);

  const patrol = await patrolFacts(pool, { now: 1_700_000_000_000 });
  assert.deepEqual(patrol, { ok: true, lastAt: null, today: 0 });
});

test("积压与重试到顶都按行算，积压年龄从最早那条算", async () => {
  const now = Date.parse("2026-10-26T04:00:00.000Z");
  const pool = poolOf({
    review: {
      last_success_at: new Date("2026-10-26T03:18:00.000Z"),
      pending_count: 3,
      pending_oldest: new Date("2026-10-26T03:13:00.000Z"),
      gave_up: 2,
      settled: 40,
      timed: 12,
      p50: 8.14,
      p95: 41.66,
    },
    errors: [{ code: "agent_timeout", n: 3 }],
  });
  const snapshot = await agentReviewSnapshot(pool, { now });
  assert.equal(snapshot.lastSuccessAt, "2026-10-26T03:18:00.000Z");
  assert.deepEqual(snapshot.pending, { count: 3, oldestMinutes: 47 });
  assert.equal(snapshot.gaveUp, 2);
  assert.deepEqual(snapshot.latencySeconds, { p50: 8.1, p95: 41.7, settled: 40, timed: 12 });
  assert.deepEqual(snapshot.errors24h, [{ code: "agent_timeout", count: 3 }]);
});

test("查询抛错时返回全 null，不抛给调用方", async () => {
  const pool = poolOf({ fail: "db down" });
  const snapshot = await agentReviewSnapshot(pool);
  assert.equal(snapshot.ok, false);
  assert.equal(snapshot.lastSuccessAt, null);
  assert.deepEqual(snapshot.pending, { count: null, oldestMinutes: null });
  assert.equal(snapshot.gaveUp, null);
  assert.deepEqual(snapshot.latencySeconds, { p50: null, p95: null, settled: null, timed: null });
  assert.deepEqual(snapshot.errors24h, []);
  assert.deepEqual(await patrolFacts(pool), { ok: false, lastAt: null, today: null });
});

test("30 秒内复用同一次查询，管理页刷新不会变成一叠 SQL", async () => {
  const pool = poolOf({ review: { pending_count: 1, gave_up: 0 }, patrol: { today: 1 } });
  const at = 1_700_000_000_000;
  await agentReviewSnapshot(pool, { now: at });
  await agentReviewSnapshot(pool, { now: at + 5_000 });
  assert.equal(pool.calls.filter((call) => call.sql.includes("percentile_cont")).length, 1);

  await agentReviewSnapshot(pool, { now: at + 31_000 });
  assert.equal(pool.calls.filter((call) => call.sql.includes("percentile_cont")).length, 2);
});

test("失败不进缓存：一次瞬时故障不该让状态坏 30 秒", async () => {
  let broken = true;
  const pool = {
    async query(sql) {
      if (broken) throw new Error("db down");
      if (sql.includes("percentile_cont")) return { rows: [{ pending_count: 0, gave_up: 0 }] };
      if (sql.includes("reviewError")) return { rows: [] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  const first = await agentReviewSnapshot(pool);
  assert.equal(first.ok, false);
  broken = false;
  const second = await agentReviewSnapshot(pool);
  assert.equal(second.ok, true);
});

test("窗口与重试上限进 SQL 参数，且 reviewAttempts 的转型有正则兜着", async () => {
  const pool = poolOf({ review: { pending_count: 0, gave_up: 0 } });
  await agentReviewSnapshot(pool);
  const call = pool.calls.find((entry) => entry.sql.includes("percentile_cont"));
  assert.deepEqual(call.params, [reviewWindow().days, reviewWindow().maxAttempts]);
  // detail 是自由 jsonb：没有这道正则，一个非数字的 reviewAttempts 会把只读端点打挂。
  assert.match(call.sql, /reviewAttempts' ~ '\^\[0-9\]\+\$'/);
});

test("耗时只取终审真的落地过的行，计数把没计时的那批说出来", async () => {
  // 0.8.1 之前的历史行与 created_at 相同：混进百分位就是一堆 0，
  // 中位数与 p95 会被压在 0 上，这个数再也提示不了「终审卡住了」。
  assert.match(
    AGENT_REVIEW_SQL.REVIEW_SQL,
    /FILTER \(WHERE i\.verdict IN \('passed','rejected'\) AND i\.updated_at > i\.created_at\)\s+AS p50/
  );
  assert.match(
    AGENT_REVIEW_SQL.REVIEW_SQL,
    /FILTER \(WHERE i\.verdict IN \('passed','rejected'\) AND i\.updated_at > i\.created_at\)\s+AS p95/
  );
  // 覆盖多少条、其中多少条可计时，一并给出去。
  assert.match(AGENT_REVIEW_SQL.REVIEW_SQL, /AS settled/);
  assert.match(AGENT_REVIEW_SQL.REVIEW_SQL, /AS timed/);

  const pool = poolOf({ review: { settled: 679, timed: 1, p50: 70.8, p95: 70.8, pending_count: 0, gave_up: 0 } });
  const snapshot = await agentReviewSnapshot(pool);
  assert.deepEqual(snapshot.latencySeconds, { p50: 70.8, p95: 70.8, settled: 679, timed: 1 });
});

test("每个查询都按时间收边，且这份模块里没有写库语句", () => {
  const source = readFileSync(new URL("./agentReview.js", import.meta.url), "utf8");
  assert.match(AGENT_REVIEW_SQL.REVIEW_SQL, /created_at > now\(\) - make_interval/);
  assert.match(AGENT_REVIEW_SQL.ERROR_SQL, /created_at > now\(\) - interval '24 hours'/);
  assert.match(AGENT_REVIEW_SQL.PATROL_SQL, /a\.action = 'patrol'/);
  // 只读：旁路的观测者不该顺手写库。
  assert.doesNotMatch(source, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
});
