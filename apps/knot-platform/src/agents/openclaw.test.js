import assert from "node:assert/strict";
import test from "node:test";
import { parseIntelReply } from "./openclaw.js";

test("a passing record keeps its category", () => {
  const reply = parseIntelReply('{"verdict":"pass","reason":"","note":"一句","category":"价格","language":"zh-hans"}');
  assert.equal(reply.verdict, "pass");
  assert.equal(reply.category, "价格");
  assert.equal(reply.language, "zh-Hans");
});

test("a language name is not a BCP 47 tag", () => {
  const reply = parseIntelReply('{"verdict":"pass","note":"一句","category":"价格","language":"中文"}');
  assert.equal(reply.language, "");
});

test("a file the reviewer cannot read is still kept", () => {
  const reply = parseIntelReply('{"verdict":"unreadable","reason":"附件打不开。","note":"一句","category":"电子书"}');
  assert.equal(reply.verdict, "pass");
  assert.equal(reply.category, "电子书");
});

test("a revoke keeps the reason and drops the category", () => {
  const reply = parseIntelReply('{"verdict":"revoke","reason":"含有欺诈内容。","category":"价格"}');
  assert.equal(reply.verdict, "revoke");
  assert.equal(reply.reason, "含有欺诈内容。");
  assert.equal(reply.category, "");
  assert.equal(reply.language, "");
});

test("an older rejection is a revoke", () => {
  const reply = parseIntelReply('{"verdict":"reject","reason":"含有欺诈内容。","category":"价格"}');
  assert.equal(reply.verdict, "revoke");
  assert.equal(reply.reason, "含有欺诈内容。");
});
