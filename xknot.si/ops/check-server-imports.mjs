// 接口进程（/opt/xknot）只拿到 server/ 与 web/src/lib/ 这两处代码。
// 部署脚本按目录同步，不按文件逐个列举 —— 曾经逐个列举漏过 subdomain.mjs，
// 远端 ERR_MODULE_NOT_FOUND，进程反复重启、门户 502。
//
// 但「按目录同步」只解决已列目录内的新文件。server/ 里再 import 第三个
// web/src 之下的地方（或干脆 import 到别处），本地与单测全绿，远端照样起不来。
// 这里把这条边界写成可执行的检查：server/ 的每个相对 import 要么落在 server/ 内，
// 要么落在随部署同步的 ops/ 或 web/src/lib/ 内。
//
// 用法：node ops/check-server-imports.mjs [--root <目录>]
// 通过时静默退出 0；有越界 import 时列出并退出 1。

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// 随部署一起同步过去的外部目录，相对仓库根。ops/ 整目录同步，web/src/lib/ 也同步。
const SYNCED_OUTSIDE = ["ops", "web/src/lib"];

// 只认静态 import 与 export ... from。写在测试文件里的 import 不进远端，部署会排除它。
const IMPORT_RE = /(?:^|[\s;()])(?:import|export)\s+(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g;
// 动态 import 同样要进远端：写成 import("../web/…") 的模块一样会在线上找不到。
const DYNAMIC_RE = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else if (entry.name.endsWith(".mjs") && !entry.name.endsWith(".test.mjs")) files.push(full);
  }
  return files;
}

/**
 * 找出越界的相对 import。
 *
 * @param {string} root 仓库根（xknot.si）
 * @returns {Promise<Array<{ file: string, specifier: string, reason: string }>>}
 */
export async function findBadServerImports(root) {
  const serverDir = path.join(root, "server");
  const synced = SYNCED_OUTSIDE.map((item) => path.join(root, item) + path.sep);
  const problems = [];
  for (const file of await walk(serverDir)) {
    const text = await readFile(file, "utf8");
    const specifiers = new Set(
      [...text.matchAll(IMPORT_RE), ...text.matchAll(DYNAMIC_RE)].map((match) => match[1])
    );
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const target = path.resolve(path.dirname(file), specifier);
      if (target.startsWith(serverDir + path.sep)) continue;
      if (synced.some((prefix) => target.startsWith(prefix))) continue;
      problems.push({
        file: path.relative(root, file),
        specifier,
        reason: `不在 server/ 或随部署同步的 ${SYNCED_OUTSIDE.join("、")} 之内`,
      });
    }
  }
  return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf("--root");
  const root = at >= 0 ? path.resolve(process.argv[at + 1]) : path.join(here, "..");
  const problems = await findBadServerImports(root);
  if (problems.length) {
    console.error("接口进程会读不到这些模块（部署只同步 server/、ops/ 与 web/src/lib/）：");
    for (const item of problems) console.error(`  ${item.file}: ${item.specifier} —— ${item.reason}`);
    process.exit(1);
  }
}
