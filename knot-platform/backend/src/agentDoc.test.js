// Agent 接口的错误码与文档的一致性护栏。
//
// docs/KNOT_HELP.md 的 Failures 表是 Agent 唯一的错误分支依据：码不在表里，
// 拿到了也只会报「未知错误」。以前这条一致性靠人跑 rg 手对，改端点时没人拦（S01-15）。
// 这里把那一遍手工检查变成断言：agent.js 能回给调用方的每个 error 码，
// 都必须出现在表的 error 列里。

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const agentRoutes = path.resolve(dir, "routes", "agent.js");
const DOC = path.resolve(dir, "../../../docs/KNOT_HELP.md");

/** agent.js 里所有 `error: "…"` 的取值。 */
function codesInRoutes() {
  const source = fs.readFileSync(agentRoutes, "utf8");
  return [...new Set([...source.matchAll(/error: "([a-z_]+)"/g)].map((match) => match[1]))].sort();
}

/** Failures 表的 error 列。同一行用 `/` 分隔多个码，所以要逐个拆开。 */
function codesInDoc(source) {
  const start = source.indexOf("## Failures");
  assert.ok(start >= 0, "KNOT_HELP.md 里找不到 Failures 一节");
  const rest = source.slice(start + "## Failures".length);
  const end = rest.search(/\n## /);
  const section = end >= 0 ? rest.slice(0, end) : rest;
  const codes = new Set();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    // | 400 | code / code | meaning | → 第二格是码
    if (cells.length < 4 || !/^\d{3}$/.test(cells[1])) continue;
    for (const code of cells[2].split("/")) {
      const value = code.trim();
      if (value) codes.add(value);
    }
  }
  return codes;
}

test("every error code the Agent API can return is listed in the Failures table", (t) => {
  // 文档放在仓库根：只有本仓形态才有这份文件。单独取用 knot-platform/ 时没有它，
  // 这时不能假装通过，也不能让整棵测试红掉，所以显式跳过并说明原因。
  if (!fs.existsSync(DOC)) {
    t.skip("docs/KNOT_HELP.md 不在当前检出中（单独取用 knot-platform/）");
    return;
  }
  const codes = codesInRoutes();
  assert.ok(codes.length > 20, "没扫到错误码，路由文件路径可能变了");
  const documented = codesInDoc(fs.readFileSync(DOC, "utf8"));
  const missing = codes.filter((code) => !documented.has(code));
  assert.deepEqual(missing, [], "这些码 Agent 会收到，但文档的 Failures 表里没有");
});
