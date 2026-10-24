// 管理后台三份语种的一致性检查。
//
// 这一页不打包、没有构建期校验，所以把能机械核对的几件事放进 node --test：
// - 三份字典的键必须完全一样（少一个键，那个语种就会露出键名）；
// - admin.js 与 index.html 里点名的键必须存在；
// - 同一个键里的 {占位符} 三份要一样（少一个，插值就会剩下字面的大括号）；
// - 语种菜单里的 id 必须都能用。

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import zhCN from "./i18n/zh-CN.js";
import zhTW from "./i18n/zh-TW.js";
import en from "./i18n/en.js";

const here = dirname(fileURLToPath(import.meta.url));
const DICTS = { "zh-CN": zhCN, "zh-TW": zhTW, en };
const LOCALE_IDS = Object.keys(DICTS);

async function read(...parts) {
  return readFile(join(here, ...parts), "utf8");
}

function placeholders(text) {
  return [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

// 键在字典里得是字符串；顺带挡掉「写了个空串」这种手滑。
test("每份字典的每一项都是非空字符串", () => {
  for (const id of LOCALE_IDS) {
    for (const [key, value] of Object.entries(DICTS[id])) {
      assert.equal(typeof value, "string", `${id} 的 ${key} 不是字符串`);
      assert.ok(value.trim().length > 0, `${id} 的 ${key} 是空的`);
    }
  }
});

test("三份字典的键一一对应", () => {
  const base = Object.keys(DICTS["zh-CN"]).sort();
  for (const id of LOCALE_IDS.slice(1)) {
    const keys = Object.keys(DICTS[id]).sort();
    const missing = base.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !base.includes(key));
    assert.deepEqual(missing, [], `${id} 缺这些键`);
    assert.deepEqual(extra, [], `${id} 多出这些键`);
  }
});

test("同一个键的占位符在三份里一致", () => {
  for (const key of Object.keys(DICTS["zh-CN"])) {
    const expected = placeholders(zhCN[key]);
    for (const id of LOCALE_IDS.slice(1)) {
      assert.deepEqual(placeholders(DICTS[id][key]), expected, `${id} 的 ${key} 占位符对不上`);
    }
  }
});

// 只认字面量：动态键（t(`users.${x}`)）由下面的固定清单兜住。
test("admin.js 里点名的键都存在", async () => {
  const source = await read("admin.js");
  const keys = new Set();
  for (const match of source.matchAll(/\bt\(\s*"([a-z][\w.]*)"/g)) keys.add(match[1]);
  for (const match of source.matchAll(/data-i18n(?:-[a-z-]+)?="([a-z][\w.]*)"/g)) keys.add(match[1]);

  const missing = [];
  for (const key of keys) {
    for (const id of LOCALE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(DICTS[id], key)) missing.push(`${id}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `这些键没有写进字典：\n${missing.join("\n")}`);
});

test("admin.js 里的动态键前缀都有对应的一组键", async () => {
  const source = await read("admin.js");
  const prefixes = new Set();
  for (const match of source.matchAll(/\bt\(\s*`([a-z][\w.]*)\.\$\{/g)) prefixes.add(match[1]);
  assert.ok(prefixes.size > 0, "应该至少有 users./profile./xknot. 这几组动态键");

  for (const prefix of prefixes) {
    assert.ok(
      Object.keys(zhCN).some((key) => key.startsWith(`${prefix}.`)),
      `动态键 ${prefix}. 没有任何对应的字典项`
    );
  }
});

// index.html 是静态标记的源头；漏了 data-i18n 的文案不会报错，只会一直显示中文。
test("index.html 里点名的键都存在", async () => {
  const html = await read("index.html");
  const keys = new Set([
    ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-i18n-placeholder="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-i18n-aria-label="([^"]+)"/g)].map((match) => match[1]),
    ...[...html.matchAll(/data-i18n-title="([^"]+)"/g)].map((match) => match[1]),
  ]);

  const missing = [];
  for (const key of keys) {
    for (const id of LOCALE_IDS) {
      if (!Object.prototype.hasOwnProperty.call(DICTS[id], key)) missing.push(`${id}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], `这些键没有写进字典：\n${missing.join("\n")}`);
});

// 页面里不该再有直接写给用户看的中文：文案一律走 t()，剩下的只该是注释。
test("admin.js 的代码里没有残留的中文文案", async () => {
  const source = await read("admin.js");
  const offenders = source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => line && !/^(\/\/|\/\*|\*)/.test(line))
    .filter(({ line }) => /[\u4e00-\u9fff]/.test(line))
    // 语言菜单里的语种名按各自的写法显示，不进字典。
    .filter(({ line }) => !line.includes("label: \"简体中文\"") && !line.includes("label: \"繁體中文\""));

  assert.deepEqual(
    offenders.map((item) => `${item.number}: ${item.line}`),
    [],
    "这些行里有硬编码的中文"
  );
});

test("i18n.js 暴露的语种与字典对得上", async () => {
  const source = await read("i18n.js");
  const ids = [...source.matchAll(/\{\s*id:\s*"([\w-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids.sort(), LOCALE_IDS.sort(), "LOCALES 与字典文件不一致");
});
