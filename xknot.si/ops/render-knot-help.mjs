// 把仓库根 docs/KNOT_HELP.md 发成中枢上的两个地址：
//   /knot-help     排版好的单页，给浏览器
//   /knot-help.md  原文，给 Agent 读
//
// 这份是跨项目的公共协议文档（不属于任何一个 Knot 实例），所以源文件在仓库根 docs/。
// 排版本身在 ops/doc-page.mjs，别的文档页可以直接复用它，这里只声明「哪一份、挂哪」。
//
// 用法：node ops/render-knot-help.mjs --out web/dist
//       node ops/render-knot-help.mjs --out /tmp/knot-help --source ../../docs/KNOT_HELP.md

import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeDocPage } from "./doc-page.mjs";
import { invokedDirectly } from "./lib/main-module.mjs";

const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 源文件在仓库根 docs/，与 xknot.si/ 是兄弟目录。
export const SOURCE = path.resolve(HUB, "..", "docs", "KNOT_HELP.md");
export const PAGE_PATH = "/knot-help";
export const RAW_PATH = "/knot-help.md";
export const SLUG = "knot-help";

// 文档没写一级标题时的兜底。正常不会用到，写了是为了不让构建产出空 <title>。
const FALLBACK_TITLE = "Knot Agent API Guide";

export function writeKnotHelp({ out, source = SOURCE }) {
  return writeDocPage({
    source,
    out,
    slug: SLUG,
    canonical: PAGE_PATH,
    rawPath: RAW_PATH,
    fallbackTitle: FALLBACK_TITLE,
    // 正文是英文，页面语种与原文入口的标签一起换成英文。
    lang: "en",
    rawLabel: "Markdown source",
    brand: { name: "XKnot", mark: "X", href: "/" },
  });
}

function parseArgs(argv) {
  const options = { out: path.join(HUB, "web", "dist"), source: SOURCE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--out") options.out = path.resolve(argv[i + 1] || options.out);
    else if (argv[i] === "--source") options.source = path.resolve(argv[i + 1]);
  }
  return options;
}

if (invokedDirectly(import.meta.url)) {
  const written = writeKnotHelp(parseArgs(process.argv.slice(2)));
  console.log(`knot-help: ${written.html} (${written.bytes} bytes markdown)`);
}
