import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 后端每个 `error: "..."` 都该在 locale 里有一句人能看懂的话。
// 没有断言的话，新码会静默落成「请求没有完成」，没人会在评审里发现。
// 只扫 WebUI 会用到的那一组路由：Agent API 的错误码不进这个界面。

const dir = path.dirname(fileURLToPath(import.meta.url));
const webRoutes = path.resolve(dir, "../../backend/src/routes/web.js");
const locales = path.join(dir, "i18n", "locales");

function codesIn(file) {
  const source = fs.readFileSync(file, "utf8");
  return [...new Set([...source.matchAll(/error: "([a-z_]+)"/g)].map((match) => match[1]))].sort();
}

// 机器对机器、界面从不显示的错误码。`/board` 的 410 是给取快照的中枢与回源判断看的：
// WebUI 拿到非 2xx 一律当没有更权威的副本，回落到入口那份，不会去找文案。
const MACHINE_ONLY = new Set(["board_unavailable"]);

test("every error code the web API can return has a message in all three locales", () => {
  const codes = codesIn(webRoutes);
  assert.ok(codes.length > 20, "没扫到错误码，路径可能变了");
  const shown = codes.filter((code) => !MACHINE_ONLY.has(code));
  for (const name of ["zh-CN.json", "zh-TW.json", "en.json"]) {
    const catalog = JSON.parse(fs.readFileSync(path.join(locales, name), "utf8"));
    const missing = shown.filter((code) => typeof catalog.error?.[code] !== "string");
    assert.deepEqual(missing, [], `${name} 缺这些错误码的文案`);
  }
});

test("a bad_price message keeps the two placeholders it interpolates", () => {
  for (const name of ["zh-CN.json", "zh-TW.json", "en.json"]) {
    const catalog = JSON.parse(fs.readFileSync(path.join(locales, name), "utf8"));
    const message = catalog.error?.bad_price || "";
    assert.ok(message.includes("{min}") && message.includes("{max}"), `${name} 的 bad_price 少了占位符`);
  }
});
