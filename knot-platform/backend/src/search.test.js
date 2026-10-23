import assert from "node:assert/strict";
import test from "node:test";
import { compact, scoreCompact, scoreText, uniqueGrams } from "./search.js";

test("an exact phrase scores above one, and above any partial match", () => {
  // 「个人助理」完整出现在正文里：4 字短语 + 3 个二元组全部命中。
  const exact = scoreText("个人助理", "个人助理的需求清单");
  // 只碰到「个人」和「助理」两个零散词，中间被别的字隔开：命中占比 2/3 < 1。
  const partial = scoreText("个人助理", "个人成长与助理招聘日报");
  assert.ok(exact >= 1, "完整命中应不低于 1");
  assert.ok(partial > 0 && partial < 1, "部分命中应在 0 和 1 之间");
  assert.ok(exact > partial, "完整命中应高于部分命中");
});

test("a single character query matches by inclusion", () => {
  assert.equal(scoreText("高", "高维"), 1);
  assert.equal(scoreText("高", "别的"), 0);
});

test("no overlap scores zero", () => {
  assert.equal(scoreText("高维", "个人助理"), 0);
  assert.equal(scoreText("", "任意"), 0);
  assert.equal(scoreText("高维", ""), 0);
});

test("scoring on already compacted text matches scoring on raw text", () => {
  const cases = [
    ["个人助理", "个人助理的需求清单"],
    ["个人助理", "个人成长与助理招聘日报"],
    ["DeepSeek", "DeepSeek V4.1 开源，模型更强"],
    ["住房", "求租：两居室住房"],
  ];
  for (const [query, text] of cases) {
    assert.equal(scoreCompact(compact(query), compact(text)), scoreText(query, text));
  }
});

test("compaction keeps letters and digits and drops punctuation", () => {
  assert.equal(compact("AI Agent：2026-10-23！"), "aiagent20261023");
  assert.equal(compact("   "), "");
});

test("bigrams are deduplicated so the index does not grow with repeats", () => {
  assert.deepEqual(uniqueGrams("住房住房"), ["住房", "房住"]);
  assert.deepEqual(uniqueGrams("高"), []);
});

test("a character outside the BMP does not leave broken surrogates in the index", () => {
  // 「𝕏」是代理对。切成二元组时它和邻居之间必然落单一个代理项：落单代理项写进
  // PostgreSQL 会变成 U+FFFD，所以这里就必须先规整，否则存下来的值与重算值不一致。
  const pieces = uniqueGrams("的𝕏私");
  // 整字那一格保留原样，两侧各自把落单的代理项换成 U+FFFD。
  assert.deepEqual(pieces, ["的\uFFFD", "𝕏", "\uFFFD私"]);
  for (const piece of pieces) {
    assert.equal(piece, piece.toWellFormed(), `${piece} 里还有落单的代理项`);
  }
});

test("an emoji next to text still matches a query with the same text", () => {
  // 规整后写入与查询用同一段文本，仍然能命中；emoji 本身以整字参与匹配。
  assert.ok(scoreText("𝕏私", "的𝕏私信") > 0);
  assert.equal(scoreText("𝕏私", "的X私信"), 0);
});

