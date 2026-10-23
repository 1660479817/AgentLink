// t("…") 的键存在性护栏。
//
// 缺键时 t() 回退成键名本身（i18n/index.js），页面不报错、测试也不红——S01-01/S01-02
// 那三个不存在的示例键就是这么漏出来的。这里把「三份 locale 齐全」从人眼检查
// 变成断言：源码里写死的每个键，三份 catalog 都要有。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const locales = path.join(dir, "i18n", "locales");

// 只看字面量键：t(`error.${code}`) 这类动态键在这里判不了，也不该硬猜。
// 前缀排除 `emit('…')` 这种以 t( 结尾的同名调用。
const CALL = /(^|[^\w$.])t\(\s*(["'])([A-Za-z0-9_.-]+)\2/g;

function sourceFiles(root) {
  const out = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(vue|js)$/.test(entry.name)) continue;
    // 测试文件里的字符串是数据，不是界面文案。
    if (/\.test\.js$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function literalKeys() {
  const keys = new Set();
  for (const file of sourceFiles(dir)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(CALL)) keys.add(match[3]);
  }
  return [...keys].sort();
}

function lookup(catalog, key) {
  let node = catalog;
  for (const part of key.split(".")) {
    if (node == null) return null;
    node = node[part];
  }
  return typeof node === "string" ? node : null;
}

test("every literal t() key exists in all three locale catalogs", () => {
  const keys = literalKeys();
  assert.ok(keys.length > 200, `只扫到 ${keys.length} 个键，源码路径可能变了`);
  for (const name of ["zh-CN.json", "zh-TW.json", "en.json"]) {
    const catalog = JSON.parse(fs.readFileSync(path.join(locales, name), "utf8"));
    const missing = keys.filter((key) => lookup(catalog, key) == null);
    assert.deepEqual(missing, [], `${name} 缺这些键；页面上会直接显示键名`);
  }
});
