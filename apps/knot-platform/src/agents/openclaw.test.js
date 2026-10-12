import assert from "node:assert/strict";
import test from "node:test";
import { parseBriefReply, parseDemandReply, parseIntelReply, parseSeekReply } from "./openclaw.js";

test("a passing packet keeps its category", () => {
  const reply = parseIntelReply('{"verdict":"pass","reason":"","note":"一句","category":"价格"}');
  assert.equal(reply.verdict, "pass");
  assert.equal(reply.category, "价格");
});

test("a passing demand keeps its category", () => {
  assert.deepEqual(parseBriefReply('{"verdict":"pass","category":"供货"}'), {
    verdict: "pass",
    reason: "",
    category: "供货",
  });
});

test("demand returns citations and the gap", () => {
  const reply = parseDemandReply('{"citations":["a","a","b"],"ask":"缺价格"}');
  assert.deepEqual(reply.citations, ["a", "b"]);
  assert.equal(reply.ask, "缺价格");
});

test("demand with nothing to cite is still a reply", () => {
  assert.deepEqual(parseDemandReply('{"citations":[],"ask":""}'), { citations: [], ask: "" });
});

test("demand without citations is unusable", () => {
  assert.throws(() => parseDemandReply('{"body":"一份文件"}'), /demand_agent_bad_json/);
});

test("seek keeps only items that name a source", () => {
  const reply = parseSeekReply(
    JSON.stringify({
      able: true,
      items: [
        { body: "有出处的事实", note: "一句", source: "公开年报" },
        { body: "没有出处", note: "一句", source: "  " },
      ],
    })
  );
  assert.equal(reply.able, true);
  assert.deepEqual(reply.items, [{ body: "有出处的事实", note: "一句", source: "公开年报" }]);
});

test("seek with no sourced item cannot fill the gap", () => {
  const reply = parseSeekReply('{"able":true,"items":[{"body":"编的","note":"","source":""}]}');
  assert.deepEqual(reply, { able: false, items: [] });
});

test("seek unable drops any items", () => {
  assert.deepEqual(parseSeekReply('{"able":false,"items":[{"body":"x","source":"y"}]}'), {
    able: false,
    items: [],
  });
});
