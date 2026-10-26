// 构建产物要能被它声称支持的浏览器解析。
//
// plugin-legacy 只把语法转译到 targets 的下限：下限写高了，async 之类的语法会原样
// 留在 nomodule 包里，而那份包正是不支持 type="module" 的内核唯一会执行的。
// 这里按各自声称的级别解析一遍，解析不过就说明那个包发到那批内核上必然 SyntaxError。
//
// 用法：node scripts/check-legacy.mjs [dist 目录]

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.argv[2] || path.join(HERE, "..", "dist"));

// legacy 包按 ES2015 解析：它的下限是 chrome 53 / safari 10，这批内核能解析全部 ES2015，
// 再往上（async、对象展开）不一定。解析不过就是白屏，这条不能放松。
//
// 现代包只发给支持 type="module" 的内核，Vite 的 es2015 目标实际会留下 async 与
// 对象展开，由 plugin-legacy 的 __vite_is_modern_browser 回落接住。这里只防
// 明显超出这批内核的语法。
const LEGACY_ECMA = 2015;
const MODERN_ECMA = 2020;

function loadAcorn() {
  const require = createRequire(import.meta.url);
  // acorn 在 vite 的依赖链上，不在本项目的 dependencies 里；取不到就明说跳过了哪一步。
  try {
    return require("acorn");
  } catch {
    return null;
  }
}

export function checkDist({ dist = DIST, acorn }) {
  const assets = path.join(dist, "assets");
  if (!fs.existsSync(assets)) return { ok: false, reason: `没有构建产物：${assets}`, checked: 0, failures: [] };
  if (!acorn) return { ok: true, reason: "acorn 不可用，未检查语法下限", checked: 0, failures: [] };

  const failures = [];
  const files = fs.readdirSync(assets).filter((name) => name.endsWith(".js"));
  for (const name of files) {
    const source = fs.readFileSync(path.join(assets, name), "utf8");
    const legacy = name.includes("-legacy-");
    try {
      acorn.parse(source, {
        ecmaVersion: legacy ? LEGACY_ECMA : MODERN_ECMA,
        sourceType: legacy ? "script" : "module",
        allowReturnOutsideFunction: true,
      });
    } catch (error) {
      failures.push({ name, legacy, message: error.message });
    }
  }
  return { ok: failures.length === 0, reason: "", checked: files.length, failures };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const result = checkDist({ acorn: loadAcorn() });
  if (!result.ok) {
    console.error(`错误：${result.reason || "构建产物里有解析不了的语法"}`);
    for (const failure of result.failures) {
      console.error(`  ${failure.legacy ? "legacy" : "modern"} ${failure.name}: ${failure.message}`);
    }
    console.error(
      "\n这通常意味着 vite.config.js 里 legacy 的 targets 被调高了：" +
        "老内核会拿到一份自己解析不了的 legacy 包。"
    );
    process.exit(1);
  }
  console.log(
    `OK: ${result.checked} 个 chunk 都能被各自声称支持的内核解析${result.reason ? `（${result.reason}）` : ""}`
  );
}
