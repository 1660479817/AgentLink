import assert from "node:assert/strict";
import test from "node:test";
import { retrievalMessage } from "./agents/openclaw.js";
import { createRetrieval, existingResponseId, prepareRetrievalJob } from "./retrieval.js";
import { servicePrice } from "./points.js";

test("a retrieval prompt carries the query and ranked internal results", () => {
  const message = retrievalMessage("最近大模型有什么进展", [
    {
      body: "DeepSeek V4.1 开源",
      category: "AI",
      detail: { note: "10月17日发布", topics: ["大模型"] },
      display_name: "日报员",
      created_at: "2026-10-17T02:00:00.000Z",
    },
    {
      body: "Grok 每日迭代",
      category: "科技",
      detail: {},
      display_name: "科技眼",
      created_at: "2026-10-18T05:13:15.000Z",
    },
  ]);
  assert.match(message, /最近大模型有什么进展/);
  assert.match(message, /DeepSeek V4.1 开源/);
  assert.match(message, /\[AI\]/);
  assert.match(message, /来源：日报员/);
  assert.match(message, /1\./);
  assert.match(message, /2\./);
});

test("a retrieval prompt with no hits still explains the empty result", () => {
  const message = retrievalMessage("没有匹配的关键词", []);
  assert.match(message, /没有命中/);
  assert.doesNotMatch(message, /平台内部检索结果（按相关度排序）/);
});

test("an empty retrieval query is rejected before any work", async () => {
  await assert.rejects(
    createRetrieval({ query: async () => ({ rows: [] }) }, { userId: "u", query: "   " }),
    (error) => error.code === "bad_body",
  );
});

test("the platform service price is a whole non-negative number", () => {
  assert.equal(servicePrice(10), 10);
  assert.equal(servicePrice("0"), 0);
  assert.equal(servicePrice(""), 0);
  assert.equal(servicePrice(null), 0);
  assert.throws(() => servicePrice(-1), (error) => error.code === "bad_price");
  assert.throws(() => servicePrice(1.5), (error) => error.code === "bad_price");
  assert.throws(() => servicePrice(100_001), (error) => error.code === "bad_price");
});

const WISH = "77777777-7777-4777-8777-777777777777";

test("a previous response is found before the agent runs again", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ id: "respond-1" }] };
    },
  };
  assert.equal(await existingResponseId(pool, WISH), "respond-1");
  assert.deepEqual(calls[0].params, [WISH]);
  assert.match(calls[0].sql, /kind = 'wishRespond'/);
  // 可见性只有一处口径（information.visibleVerdict）：被撤销或删掉的响应不算「已经有结果」，
  // 否则这条检索会永远停在进行中。
  assert.match(calls[0].sql, /verdict IN \('pending', 'passed'\)/);
});

test("no response yet returns null", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  assert.equal(await existingResponseId(pool, WISH), null);
});

// 重复提交同一句是常态（代理超时后会重发）。任务行用 upsert 认回原来那一行：
// 在跑的不重排，已交付的不重发，只有响应被撤销/删除或上一次失败才重新排队。
test("a repeated retrieval keeps the same job instead of queueing another", async () => {
  for (const status of ["pending", "running"]) {
    const calls = [];
    const pool = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [{ id: "job-1", status }] };
      },
    };
    const result = await prepareRetrievalJob(pool, { wishId: WISH, userId: "u", query: "同一句" });
    assert.deepEqual(result, { jobId: "job-1", status, duplicate: true, run: false });
    // 一次 upsert 就够了，不能再 UPDATE 回 pending。
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /ON CONFLICT \(wish_id\) DO UPDATE SET query = EXCLUDED\.query/);
  }
});

test("a done retrieval with a visible response is not run again", async () => {
  const calls = [];
  const pool = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes("INSERT INTO retrieval_jobs")) return { rows: [{ id: "job-2", status: "done" }] };
      if (sql.includes("kind = 'wishRespond'")) return { rows: [{ id: "respond-1" }] };
      return { rows: [] };
    },
  };
  const result = await prepareRetrievalJob(pool, { wishId: WISH, userId: "u", query: "同一句" });
  assert.deepEqual(result, { jobId: "job-2", status: "done", duplicate: true, run: false });
  assert.equal(calls.some((sql) => sql.includes("UPDATE retrieval_jobs SET status = 'pending'")), false);
});

test("a done retrieval whose response was revoked is queued again", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO retrieval_jobs")) return { rows: [{ id: "job-3", status: "done" }] };
      if (sql.includes("kind = 'wishRespond'")) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await prepareRetrievalJob(pool, { wishId: WISH, userId: "u", query: "同一句" });
  assert.deepEqual(result, { jobId: "job-3", status: "pending", duplicate: false, run: true });
  const update = calls.find((call) => call.sql.includes("UPDATE retrieval_jobs SET status = 'pending'"));
  assert.deepEqual(update.params, ["job-3"]);
});

test("a failed retrieval is queued again from zero attempts", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO retrieval_jobs")) return { rows: [{ id: "job-4", status: "failed" }] };
      return { rows: [] };
    },
  };
  const result = await prepareRetrievalJob(pool, { wishId: WISH, userId: "u", query: "同一句" });
  assert.equal(result.run, true);
  const update = calls.find((call) => call.sql.includes("UPDATE retrieval_jobs SET status = 'pending'"));
  assert.match(update.sql, /attempts = 0/);
});
