// 「是否被直接执行」的判断只能比真实路径。
//
// 构建产物里那些静态页（knot-help、robots、sitemap、实例目录）都由 ops/ 下的脚本
// 在 vite 之后补写。它们从 `<部署根>/current` 拉起时，node 算 import.meta.url 已经
// 把软链解开，而 argv[1] 还是调用方写的字符串；直接按字符串比，脚本会整段跳过、
// 退出 0，构建照样打印 done，只是那几个文件根本没生成。
//
// 这不是假想：在 /tmp 下的检出里构建（macOS 上 /tmp 是 /private/tmp 的软链）就是
// 这个样子。而 deploy-hub.sh 带 --delete，缺的文件会被从线上删掉。
//
// 所以这里不做行为测试，只守住写法：新增入口时复制错模板就会红。

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["ops", "server"];
const EXEMPT = new Set();

function sources(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (name === "node_modules" || name === "fixtures") continue;
      found.push(...sources(full));
    } else if (/\.(mjs|js)$/.test(name) && !/\.test\.(mjs|js)$/.test(name)) {
      found.push(full);
    }
  }
  return found;
}

test("没有脚本用未解析的路径判断自己是否被直接执行", () => {
  const offenders = [];
  for (const root of ROOTS) {
    for (const file of sources(path.join(HUB, root))) {
      const rel = path.relative(HUB, file);
      if (EXEMPT.has(rel)) continue;
      for (const [index, line] of readFileSync(file, "utf8").split("\n").entries()) {
        if (!line.includes("process.argv[1]")) continue;
        if (!line.includes("import.meta.url")) continue;
        if (!/path\.resolve|===\s*fileURLToPath|resolved\s*===/.test(line)) continue;
        offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `请改用 ops/lib/main-module.mjs 的 invokedDirectly：\n${offenders.join("\n")}`);
});

test("构建链上的每个入口都用共享判断", () => {
  // 缺一个就是「构建说成功、产物少一半」。这条清单跟着 build-hub.sh 与部署脚本走。
  const must = [
    "ops/build-hub-data.mjs",
    "ops/build-seo.mjs",
    "ops/render-knot-help.mjs",
    "ops/verify-hub-data.mjs",
    "ops/check-health.mjs",
    "ops/fetch-profile.mjs",
    "ops/fetch-cards.mjs",
    "ops/fetch-stats.mjs",
  ];
  for (const rel of must) {
    const text = readFileSync(path.join(HUB, rel), "utf8");
    assert.match(text, /invokedDirectly\(import\.meta\.url\)/, `${rel} 应使用 invokedDirectly(import.meta.url)`);
  }
});

test("helper 在软链路径下也认得出被直接执行", () => {
  // 真正的行为断言：临时建一个「软链目录里的脚本」，两种调用方式都必须判为直接执行。
  const root = mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "knot-main-"));
  try {
    const real = path.join(root, "real");
    mkdirSync(real);
    writeFileSync(path.join(real, "probe.mjs"), `
      import { invokedDirectly } from ${JSON.stringify(path.join(HUB, "ops/lib/main-module.mjs"))};
      console.log(invokedDirectly(import.meta.url) ? "direct" : "skipped");
    `);
    symlinkSync(real, path.join(root, "link"));
    const viaLink = execFileSync(process.execPath, [path.join(root, "link", "probe.mjs")], { encoding: "utf8" }).trim();
    const viaReal = execFileSync(process.execPath, [path.join(real, "probe.mjs")], { encoding: "utf8" }).trim();
    assert.equal(viaLink, "direct");
    assert.equal(viaReal, "direct");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
