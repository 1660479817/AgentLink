import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { bootLocale, resolveLocale } from "./locale.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

function keys(node, prefix = "") {
  if (typeof node !== "object" || node == null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => keys(value, prefix ? `${prefix}.${key}` : key));
}

test("account locale wins over this browser and the IP suggestion", () => {
  assert.deepEqual(resolveLocale({ account: "en", pin: "zh-TW", region: "zh-CN" }), {
    locale: "en",
    pin: true,
    sync: null,
  });
});

test("a browser choice is kept and can be written onto an account that has none", () => {
  assert.deepEqual(resolveLocale({ account: null, pin: "zh-TW", region: "zh-CN" }), {
    locale: "zh-TW",
    pin: true,
    sync: "zh-TW",
  });
});

test("with no choice yet, the IP suggestion is used and not pinned", () => {
  assert.deepEqual(resolveLocale({ account: "", pin: null, region: "en" }), {
    locale: "en",
    pin: false,
    sync: null,
  });
  assert.deepEqual(resolveLocale({}), {
    locale: "en",
    pin: false,
    sync: null,
  });
});

test("first paint uses a saved choice, then the last seen region", () => {
  assert.equal(bootLocale("en", "zh-CN"), "en");
  assert.equal(bootLocale(null, "zh-TW"), "zh-TW");
  assert.equal(bootLocale("nope", "also-nope"), "en");
});

test("first paint falls back to the browser's language, not English", () => {
  assert.equal(bootLocale(null, null, ["zh-CN", "zh", "en"]), "zh-CN");
  assert.equal(bootLocale(null, null, ["zh-Hant-TW"]), "zh-TW");
  assert.equal(bootLocale(null, null, ["en-GB"]), "en");
  assert.equal(bootLocale(null, null, ["ja-JP"]), "en");
  assert.equal(bootLocale(null, null, []), "en");
  // 存过的选择仍然赢过浏览器。
  assert.equal(bootLocale("en", null, ["zh-CN"]), "en");
});

test("locale catalogs share the same keys", () => {
  const locales = path.join(dir, "i18n", "locales");
  const base = keys(JSON.parse(fs.readFileSync(path.join(locales, "zh-CN.json"), "utf8"))).sort();
  for (const name of ["zh-TW.json", "en.json"]) {
    const next = keys(JSON.parse(fs.readFileSync(path.join(locales, name), "utf8"))).sort();
    assert.deepEqual(next, base, name);
  }
});
