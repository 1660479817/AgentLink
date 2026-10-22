import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SITE_LOCALE,
  hasCjkScript,
  inferLocale,
  isLocale,
  LOCALES,
  parseLocale,
  topicMatchesLanguage,
} from "./index.mjs";

test("only the three interface languages exist", () => {
  assert.deepEqual(LOCALES, ["zh-CN", "zh-TW", "en"]);
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("zh"), false);
  assert.equal(isLocale("en-US"), false);
  assert.equal(isLocale(null), false);
});

test("parseLocale trims and refuses anything outside the list", () => {
  assert.equal(parseLocale(" en "), "en");
  assert.equal(parseLocale("zh-TW"), "zh-TW");
  assert.equal(parseLocale("ja"), null);
  assert.equal(parseLocale(""), null);
  assert.equal(parseLocale(undefined), null);
});

test("the migration placeholder is one value, not a chain", () => {
  assert.ok(isLocale(DEFAULT_SITE_LOCALE));
  assert.equal(DEFAULT_SITE_LOCALE, "zh-CN");
});

test("inferLocale reads the copy, not the visitor", () => {
  assert.equal(inferLocale("一个站点，收发一手情报"), "zh-CN");
  assert.equal(inferLocale("a site for agents"), "en");
  assert.equal(inferLocale(""), "en");
  assert.equal(inferLocale(null), "en");
});

test("hasCjkScript sees Han, kana and hangul, but not latin", () => {
  assert.equal(hasCjkScript("大模型"), true);
  assert.equal(hasCjkScript("モデル"), true);
  assert.equal(hasCjkScript("모델"), true);
  assert.equal(hasCjkScript("Agent 2026"), false);
  assert.equal(hasCjkScript(""), false);
});

test("a topic must be written in the content's language", () => {
  // 英文正文：中文标签不收，英文与技术名词收。
  assert.equal(topicMatchesLanguage("联邦网络", "en"), false);
  assert.equal(topicMatchesLanguage("内容枢纽", "en-US"), false);
  assert.equal(topicMatchesLanguage("Agent", "en"), true);
  assert.equal(topicMatchesLanguage("pull request", "en"), true);
  // 中文、日文、韩文正文：中文与原文专名都收。
  assert.equal(topicMatchesLanguage("大模型", "zh"), true);
  assert.equal(topicMatchesLanguage("模型", "zh-Hans"), true);
  assert.equal(topicMatchesLanguage("Action", "zh-TW"), true);
  assert.equal(topicMatchesLanguage("モデル", "ja"), true);
  assert.equal(topicMatchesLanguage("모델", "ko"), true);
  // 语种没写或看不准时不管，不能因为评审员漏填就丢标签。
  assert.equal(topicMatchesLanguage("联邦网络", ""), true);
  assert.equal(topicMatchesLanguage("联邦网络", "und"), true);
  assert.equal(topicMatchesLanguage("联邦网络", null), true);
});
