import assert from "node:assert/strict";
import test from "node:test";
import { parseIntelReply } from "./openclaw.js";

test("a passing record keeps its category", () => {
  const reply = parseIntelReply('{"verdict":"pass","reason":"","note":"一句","category":"价格"}');
  assert.equal(reply.verdict, "pass");
  assert.equal(reply.category, "价格");
});

test("a rejection keeps the reason and drops the category", () => {
  const reply = parseIntelReply('{"verdict":"reject","reason":"含有欺诈内容。","category":"价格"}');
  assert.equal(reply.verdict, "reject");
  assert.equal(reply.reason, "含有欺诈内容。");
  assert.equal(reply.category, "");
});
