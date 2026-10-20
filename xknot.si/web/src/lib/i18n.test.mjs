import assert from "node:assert/strict";
import test from "node:test";

import { groupsOf, groupOf, isCountryCode } from "./regions.js";
import {
  DEFAULT_LOCALE,
  formatWhen,
  hreflangAlternates,
  isLocale,
  localeHref,
  makeT,
  pickLocalized,
  resolveLocale,
  translate,
} from "./i18n.js";

test("supported locales match the WebUI set", () => {
  assert.equal(isLocale("en"), true);
  assert.equal(isLocale("zh-CN"), true);
  assert.equal(isLocale("zh-TW"), true);
  assert.equal(isLocale("zh"), false);
  assert.equal(DEFAULT_LOCALE, "en");
});

test("a preferred list resolves to the first supported locale", () => {
  assert.equal(resolveLocale(["fr", "zh-TW", "en"]), "zh-TW");
  assert.equal(resolveLocale("en-US"), "en");
  assert.equal(resolveLocale("ZH_cn"), "zh-CN");
  assert.equal(resolveLocale(["de", "fr"]), "en");
  assert.equal(resolveLocale(null), "en");
});

test("a bare language falls back to its first variant", () => {
  assert.equal(resolveLocale("zh"), "zh-CN");
});

test("pickLocalized prefers the requested locale", () => {
  const map = { en: "Knot", "zh-CN": "Knot 中文", "zh-TW": "Knot 繁體" };
  assert.equal(pickLocalized(map, "zh-TW"), "Knot 繁體");
});

test("pickLocalized falls back to the base language, then en", () => {
  assert.equal(pickLocalized({ en: "Hello", "zh-CN": "你好" }, "zh-TW"), "你好");
  assert.equal(pickLocalized({ en: "Hello" }, "zh-TW"), "Hello");
});

test("pickLocalized returns the first available value when en is missing", () => {
  assert.equal(pickLocalized({ ja: "こんにちは" }, "zh-CN"), "こんにちは");
  assert.equal(pickLocalized({}, "zh-CN"), null);
  assert.equal(pickLocalized(null, "zh-CN"), null);
});

test("pickLocalized treats an empty string as missing", () => {
  assert.equal(pickLocalized({ en: "Hello", "zh-CN": "  " }, "zh-CN"), "Hello");
});

test("locale hrefs and hreflang cover every locale plus x-default", () => {
  assert.equal(localeHref("zh-CN"), "/zh-CN/");
  assert.equal(localeHref("en", "instances/"), "/en/instances/");
  const alternates = hreflangAlternates();
  assert.deepEqual(alternates.map((item) => item.hreflang), ["en", "zh-CN", "zh-TW", "x-default"]);
  assert.equal(alternates.at(-1).href, "/en/");
});

test("relative time follows the locale", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const threeHoursAgo = new Date("2026-10-19T09:00:00Z");
  assert.match(formatWhen(threeHoursAgo, "en", { now }), /3 hours ago/);
  assert.match(formatWhen(threeHoursAgo, "zh-CN", { now }), /3/);
});

test("anything older than seven days becomes an absolute date", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const old = new Date("2026-09-01T00:00:00Z");
  const text = formatWhen(old, "en", { now });
  assert.equal(text, "Sep 1, 2026");
});

test("absolute dates honour the instance timezone", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  const old = new Date("2026-09-01T20:00:00Z");
  const shanghai = formatWhen(old, "en", { now, timeZone: "Asia/Shanghai" });
  assert.equal(shanghai, "Sep 2, 2026");
});

test("an invalid date yields null instead of NaN text", () => {
  assert.equal(formatWhen("not a date", "en"), null);
});

test("translate returns null for a missing key instead of the key itself", () => {
  const catalog = { portal: { title: "Knot" } };
  assert.equal(translate(catalog, "portal.title"), "Knot");
  assert.equal(translate(catalog, "portal.missing"), null);
  assert.equal(translate(catalog, "nav.instances"), null);
});

test("translate interpolates vars", () => {
  const catalog = { instance: { count: "{count} instances" } };
  assert.equal(translate(catalog, "instance.count", { count: 3 }), "3 instances");
});

test("makeT falls back to English and then to the key", () => {
  const local = { portal: { title: "XKnot 联邦" } };
  const english = { portal: { title: "XKnot Federation", tagline: "Tag" } };
  const t = makeT(local, english);
  assert.equal(t("portal.title"), "XKnot 联邦");
  assert.equal(t("portal.tagline"), "Tag");
  assert.equal(t("portal.missing"), "portal.missing");
});

test("country codes are grouped and unknown codes fall into other", () => {
  assert.equal(groupOf("CN"), "east-asia");
  assert.equal(groupOf("SG"), "southeast-asia");
  assert.equal(groupOf("SI"), "europe");
  assert.equal(groupOf("AQ"), "other");
  assert.equal(groupOf("GLOBAL"), "global");
  assert.equal(isCountryCode("GLOBAL"), true);
  assert.equal(isCountryCode("XX"), false);
});

test("three or more groups collapse into global", () => {
  assert.deepEqual(groupsOf(["SG"]), ["southeast-asia"]);
  assert.deepEqual(groupsOf(["SG", "MY"]), ["southeast-asia"]);
  assert.deepEqual(groupsOf(["CN", "SG", "SI"]), ["global"]);
  assert.deepEqual(groupsOf(["GLOBAL"]), ["global"]);
  assert.deepEqual(groupsOf([]), []);
});

test("region groups come back in the fixed display order", () => {
  assert.deepEqual(groupsOf(["SI", "JP"]), ["east-asia", "europe"]);
});
