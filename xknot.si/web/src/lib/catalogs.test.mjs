import assert from "node:assert/strict";
import test from "node:test";

import en from "../locales/en.json" with { type: "json" };
import zhCN from "../locales/zh-CN.json" with { type: "json" };
import zhTW from "../locales/zh-TW.json" with { type: "json" };

const catalogs = { en, "zh-CN": zhCN, "zh-TW": zhTW };
const locales = Object.keys(catalogs);

// 把嵌套目录压成 a.b.c 路径，便于比较三份词条。
function paths(value, prefix = "") {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    paths(child, prefix ? `${prefix}.${key}` : key)
  );
}

function lookup(catalog, path) {
  return path.split(".").reduce((node, key) => (node ? node[key] : undefined), catalog);
}

test("every locale defines the same keys", () => {
  const base = paths(en).sort();
  for (const locale of locales) {
    assert.deepEqual(paths(catalogs[locale]).sort(), base, `${locale} key set`);
  }
});

test("every key resolves to a non-empty string", () => {
  for (const locale of locales) {
    for (const path of paths(catalogs[locale])) {
      const value = lookup(catalogs[locale], path);
      assert.equal(typeof value, "string", `${locale}:${path} type`);
      assert.ok(value.trim().length > 0, `${locale}:${path} is empty`);
    }
  }
});

test("placeholders match across locales", () => {
  const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const path of paths(en)) {
    const expected = placeholders(lookup(en, path));
    for (const locale of locales) {
      assert.deepEqual(
        placeholders(lookup(catalogs[locale], path)),
        expected,
        `${locale}:${path} placeholders`
      );
    }
  }
});
