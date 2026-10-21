import assert from "node:assert/strict";
import { test } from "node:test";
import { pickLocale } from "./brand.js";

const name = { "zh-CN": "王家小站", "zh-TW": "王家小站", en: "Wang's Place" };

test("the current locale wins", () => {
  assert.equal(pickLocale(name, "en"), "Wang's Place");
  assert.equal(pickLocale(name, "zh-TW"), "王家小站");
});

test("an empty translation falls back instead of showing blank", () => {
  assert.equal(pickLocale({ "zh-CN": "王家小站", en: "  " }, "en"), "王家小站");
  assert.equal(pickLocale({ "zh-CN": "王家小站" }, "zh-TW"), "王家小站");
});

test("a name in an unexpected locale is still usable", () => {
  assert.equal(pickLocale({ ja: "王さんの場所" }, "en"), "王さんの場所");
});

test("missing or malformed maps read as empty", () => {
  assert.equal(pickLocale(undefined, "en"), "");
  assert.equal(pickLocale(null, "en"), "");
  assert.equal(pickLocale({}, "en"), "");
  assert.equal(pickLocale("王家小站", "en"), "");
});
