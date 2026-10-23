import assert from "node:assert/strict";
import test from "node:test";
import { retrievalMessage } from "./agents/openclaw.js";
import { createRetrieval, existingResponseId } from "./retrieval.js";
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
  // 被撤销或删掉的响应不算「已经有结果」，否则这条检索会永远停在进行中。
  assert.match(calls[0].sql, /verdict NOT IN \('rejected', 'removed'\)/);
});

test("no response yet returns null", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  assert.equal(await existingResponseId(pool, WISH), null);
});
