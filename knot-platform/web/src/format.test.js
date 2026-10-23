import assert from "node:assert/strict";
import test from "node:test";
import { listText } from "./format.js";

test("the list separator follows the locale", () => {
  // 中文用顿号，英文用逗号加空格；不出现「和 / and」这种连接词。
  assert.equal(listText(["A", "B", "C"], "zh-CN"), "A、B、C");
  assert.equal(listText(["A", "B", "C"], "en"), "A, B, C");
  assert.equal(listText(["A"], "en"), "A");
});

test("an empty or missing list has no text", () => {
  assert.equal(listText([], "zh-CN"), "");
  assert.equal(listText(null, "zh-CN"), "");
  assert.equal(listText(["", "  "], "zh-CN"), "");
});
