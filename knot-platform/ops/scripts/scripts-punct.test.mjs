import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// macOS 自带的是 bash 3.2，变量名后面紧跟中文标点时，它会把标点的第一个字节
// 算进变量名：`echo "$HOST（x）"` 报 `HOST�: unbound variable`。
// 在 Linux 的 bash 5 上却正常，所以这类脚本常常是「部署机上没事，开发机上炸」。
// 统一写成 `${VAR}`，两种 bash 都没歧义。
const DIR = fileURLToPath(new URL("./", import.meta.url));
const RISKY = /\$([A-Za-z_][A-Za-z0-9_]*)([^\x00-\x7F])/;

const scripts = readdirSync(DIR)
  .filter((name) => name.endsWith(".sh") || name === "lib")
  .flatMap((name) => {
    if (name !== "lib") return [name];
    return readdirSync(new URL("./lib/", import.meta.url))
      .filter((inner) => inner.endsWith(".sh"))
      .map((inner) => `lib/${inner}`);
  });

test("shell 脚本里变量后面不直接跟中文标点", () => {
  const offenders = [];
  for (const script of scripts) {
    const lines = readFileSync(new URL(`./${script}`, import.meta.url), "utf8").split("\n");
    lines.forEach((line, index) => {
      // 注释里不会展开，跳过。
      if (/^\s*#/.test(line)) return;
      const hit = line.match(RISKY);
      if (!hit) return;
      offenders.push(`${script}:${index + 1} \$${hit[1]} 后面跟着「${hit[2]}」，改成 \${${hit[1]}}`);
    });
  }
  assert.deepEqual(offenders, []);
});
