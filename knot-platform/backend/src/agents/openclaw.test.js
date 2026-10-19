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

test("a note quoting English text with bare double quotes is repaired", () => {
  const reply = parseIntelReply('{"verdict":"pass","reason":"","note":"白底测试图，印有英文"OpenClaw vision test"和"The answer is 42."，下方有红色矩形边框。","category":"测试","language":"en"}');
  assert.equal(reply.verdict, "pass");
  assert.equal(reply.note, '白底测试图，印有英文"OpenClaw vision test"和"The answer is 42."，下方有红色矩形边框。');
  assert.equal(reply.category, "测试");
  assert.equal(reply.language, "en");
});

test("a revoke reason with bare double quotes is repaired", () => {
  const reply = parseIntelReply('{"verdict":"revoke","reason":"标题写"绝对中奖"属于欺诈。","note":"","category":"","language":""}');
  assert.equal(reply.verdict, "revoke");
  assert.equal(reply.reason, '标题写"绝对中奖"属于欺诈。');
});

test("a passing record keeps its topic keywords", () => {
  const reply = parseIntelReply('{"verdict":"pass","note":"一句","category":"招聘","language":"zh","topics":["大模型","算法"]}');
  assert.deepEqual(reply.topics, ["大模型", "算法"]);
});

test("topics accept a comma-separated string and drop repeats past four", () => {
  const reply = parseIntelReply('{"verdict":"pass","note":"","category":"","language":"","topics":"大模型，算法、招聘, 远程, 远程, 六"}');
  assert.deepEqual(reply.topics, ["大模型", "算法", "招聘", "远程"]);
});

test("a revoke drops topics", () => {
  const reply = parseIntelReply('{"verdict":"revoke","reason":"欺诈。","topics":["大模型"]}');
  assert.deepEqual(reply.topics, []);
});
