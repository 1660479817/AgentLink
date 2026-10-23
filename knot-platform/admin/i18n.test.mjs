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
  // 前缀清单是固定的：少一组说明正则漏了，多一组要先在这里登记再补键。
  assert.deepEqual([...prefixes].sort(), ["error", "profile", "users", "xknot"]);

  for (const prefix of prefixes) {
    assert.ok(
      Object.keys(zhCN).some((key) => key.startsWith(`${prefix}.`)),
      `动态键 ${prefix}. 没有任何对应的字典项`
    );
  }
});

// 逐个核对，而不是只看「error. 前缀存在」：以前 error.rate_limited 就是这样漏过去的。
test("Backend 会原样回的错误码都有文案", async () => {
  const route = await readFile(join(here, "..", "backend", "src", "routes", "admin.js"), "utf8");
  const codes = new Set();
  for (const match of route.matchAll(/json\(\{\s*error:\s*"([a-z][a-z_]+)"/g)) codes.add(match[1]);
  const table = route.slice(
    route.indexOf("function sendAdminError"),
    route.indexOf("export function tunnelLocalPort")
  );
  for (const match of table.matchAll(/code === "([a-z][a-z_]+)"/g)) codes.add(match[1]);

  assert.ok(codes.size > 0, "没能从 Backend 里读出错误码");
  const missing = [...codes].filter((code) => !Object.prototype.hasOwnProperty.call(zhCN, `error.${code}`));
  assert.deepEqual(missing.sort(), [], `这些错误码没有写进字典：${missing.join("、")}`);
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

// 同一件事在 index.html 上也要管：漏了 data-i18n 的文案不会报错，只会永远显示中文。
// <code> 里的路径占位（<站点>）是示例，不是界面文案，先剔掉。
test("index.html 里没有绕过字典的中文文案", async () => {
  const html = await read("index.html");
  const stripped = html.replace(/<code[\s\S]*?<\/code>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const offenders = [];
  for (const match of stripped.matchAll(/>([^<>]+)</g)) {
    const text = match[1].trim();
    if (text && /[\u4e00-\u9fff]/.test(text)) offenders.push(text);
  }
  for (const match of stripped.matchAll(/(?:placeholder|title|aria-label)="([^"]*)"/g)) {
    if (/[\u4e00-\u9fff]/.test(match[1])) offenders.push(match[0]);
  }
  const title = /<title>([\s\S]*?)<\/title>/.exec(stripped);
  if (title && /[\u4e00-\u9fff]/.test(title[1])) offenders.push(title[0]);

  assert.deepEqual(offenders, [], "这些文案要写进字典，并用 data-i18n 挂上");
});

test("i18n.js 暴露的语种与字典对得上", async () => {
  const source = await read("i18n.js");
  const ids = [...source.matchAll(/\{\s*id:\s*"([\w-]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids.sort(), LOCALE_IDS.sort(), "LOCALES 与字典文件不一致");
});
