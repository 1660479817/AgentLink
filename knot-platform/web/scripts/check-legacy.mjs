// 构建产物要能被它声称支持的浏览器解析。
//
// 这一条守的是 2026-10-25 那次「微信里一片空白」的一类成因：两套产物各按自己的
// 下限转译，而 targets 一旦被调高（比如 chrome 61），async/await 就会原样留在
// legacy 包里。支持 type="module" 的内核用现代包没事，不支持 module 的老内核
// 拿到的正是这份跑不起来的 legacy 包——两套都白。
//
// 检查的是语法级别，不是功能：legacy 包按 ES2015 解析（Chrome 53 / Safari 10 能解析），
// 现代包按 ES2015 module 解析。解析不过就说明这个包发到那批内核上必然 SyntaxError。
//
// 用法：node scripts/check-legacy.mjs [dist 目录]

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.argv[2] || path.join(HERE, "..", "dist"));

// 两个阈值不一样，因为两套产物本来就不同：
//
// legacy 包是**老内核唯一的路径**——不支持 type="module" 的浏览器只会跑它。
// 这里按 ES2015 解析（Chrome 53 / Safari 10 能解析全部语法），它解析不过，
// 那批用户就一定是白屏。这条不能放松。
//
// 现代包只发给支持 type="module" 的内核（Chrome 61+ / Safari 11+）。Vite 的
// build.target: "es2015" 实际会留下 async 与对象展开（Chrome 60 / Safari 11.1 起），
// 再往后的内核才都认识；Safari 11.0 撞上会 SyntaxError，由 plugin-legacy 的
// __vite_is_modern_browser 回落接住。所以这里只防「明显超出这批内核」的语法。
const LEGACY_ECMA = 2015;
const MODERN_ECMA = 2020;

function loadAcorn() {
  const require = createRequire(import.meta.url);
  // acorn 是 vite 依赖链上的包，不在本项目的 dependencies 里。
  // 找不到就明说跳过了哪一步，不要静默通过。
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
