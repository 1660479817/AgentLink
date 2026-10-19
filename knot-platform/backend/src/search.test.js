import assert from "node:assert/strict";
import test from "node:test";
import { scoreText } from "./search.js";

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
