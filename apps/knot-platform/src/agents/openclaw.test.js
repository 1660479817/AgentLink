import assert from "node:assert/strict";
import test from "node:test";
import { parseBriefReply, parseDemandReply, parseIntelReply } from "./openclaw.js";

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

test("demand returns each citation once", () => {
  assert.deepEqual(parseDemandReply('{"citations":["a","a","b"],"ask":"缺价格"}'), { citations: ["a", "b"] });
});

test("demand with nothing to cite is still a reply", () => {
  assert.deepEqual(parseDemandReply('{"citations":[]}'), { citations: [] });
});

test("demand without citations is unusable", () => {
  assert.throws(() => parseDemandReply('{"body":"一份文件"}'), /demand_agent_bad_json/);
});
