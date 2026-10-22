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

test("the person's own choice wins over the site default", () => {
  assert.deepEqual(resolveLocale({ account: "en", pin: "zh-TW", site: "zh-CN" }), {
    locale: "en",
    pin: true,
    sync: null,
  });
});

test("a browser choice is kept and can be written onto an account that has none", () => {
  assert.deepEqual(resolveLocale({ account: null, pin: "zh-TW", site: "zh-CN" }), {
    locale: "zh-TW",
    pin: true,
    sync: "zh-TW",
  });
});

test("with no choice, the site default applies and is not pinned", () => {
  assert.deepEqual(resolveLocale({ account: null, pin: null, site: "en" }), {
    locale: "en",
    pin: false,
    sync: null,
  });
  assert.deepEqual(resolveLocale({ account: "", pin: "nope", site: "zh-TW" }), {
    locale: "zh-TW",
    pin: false,
    sync: null,
  });
});

test("a missing or malformed site default falls to the one placeholder", () => {
  assert.deepEqual(resolveLocale({}), { locale: "zh-CN", pin: false, sync: null });
  assert.deepEqual(resolveLocale({ site: "ja" }), { locale: "zh-CN", pin: false, sync: null });
});

test("first paint only knows the browser choice", () => {
  assert.equal(bootLocale("en"), "en");
  assert.equal(bootLocale("zh-TW"), "zh-TW");
  assert.equal(bootLocale(null), "zh-CN");
  assert.equal(bootLocale("nope"), "zh-CN");
  // 浏览器语言不参与：本机装的是日文也一样。
  assert.equal(bootLocale(undefined), "zh-CN");
});

test("locale catalogs share the same keys", () => {
  const locales = path.join(dir, "i18n", "locales");
  const base = keys(JSON.parse(fs.readFileSync(path.join(locales, "zh-CN.json"), "utf8"))).sort();
  for (const name of ["zh-TW.json", "en.json"]) {
    const next = keys(JSON.parse(fs.readFileSync(path.join(locales, name), "utf8"))).sort();
    assert.deepEqual(next, base, name);
  }
});
