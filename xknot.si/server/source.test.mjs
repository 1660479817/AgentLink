// 源码扫描：注释行里不能藏语句。
//
// 这条规则来自一次真事故：把 `const healthFile = ...` 接在上一行 `//` 注释尾部，
// 注释把整条声明吞掉，`statSync(healthFile)` 每次都抛 ReferenceError，
// 被 catch 咽下去之后，总览里的探测状态永远是 unknown。语法检查、单元测试
// 都没报错，因为出错的那条路径在真实进程启动时才走到。
//
// 判据很窄：以 `//` 开头的行，出现变量声明关键字加一个标识符再接 `=`，
// 就当作「代码被写进了注释」。用法示例里的 `node`、`npm` 命令不会命中。
//
// 这个文件自己要讲这段历史，所以扫描时跳过自己。

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");
const DIRS = ["server", "ops"];
const DECLARATION = /^\s*\/\/.*\b(const|let|var)\s+[A-Za-z_$][\w$]*\s*=/;

function sourceFiles() {
  const files = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const file = path.join(ROOT, dir, name);
      if (name.endsWith(".mjs") && file !== SELF) files.push(file);
    }
  }
  return files;
}

test("source: no statement is hidden inside a // comment", () => {
  const offenders = [];
  for (const file of sourceFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!DECLARATION.test(line)) return;
      offenders.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `这些行把代码写进了注释，整条语句不会执行：\n${offenders.join("\n")}`);
});
