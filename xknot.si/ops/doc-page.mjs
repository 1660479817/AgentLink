// 一份 markdown 发成一个独立网页 + 一份原文。门户上所有「静态文档页」共用这一套：
//   <slug>.html  排版好的单页，给浏览器
//   <slug>.md    原文原样，给 Agent 和 curl
//
// 构建时生成，进 web/dist。门户是纯静态的，这里不需要任何运行时依赖，也不连 Backend。
//
// 这里只管排版：标题怎么取、宽表怎么滚动、外链带什么 rel、页面骨架长什么样。
// 「哪一份文档、挂在哪两个地址」由调用方给（见 render-knot-help.mjs）。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Marked } from "marked";

// 页面样式。门户的 webfont 不在这一页加载（它是静态产物，不跟 Vite 打包），
// 字体名保留为首选、后面全部落到系统字体：断网或字体被墙时排版不变。
export const DEFAULT_STYLE = `
:root {
  color-scheme: light;
  --page: #f3f6fb;
  --surface: #ffffff;
  --ink: #0a1322;
  --muted: #475569;
  --dim: #64748b;
  --accent: #0b5fff;
  --line: #e1e8f2;
  --soft: #f6f9fd;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--page);
  color: var(--ink);
  font-family: "Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei", system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.7;
}
.bar {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-height: 56px;
  padding: 0.5rem max(1rem, env(safe-area-inset-left));
  background: rgba(255, 255, 255, 0.92);
  border-bottom: 1px solid var(--line);
  backdrop-filter: blur(8px);
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ink);
  font-weight: 700;
  text-decoration: none;
}
.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
}
.spacer { flex: 1; }
.raw {
  color: var(--dim);
  font-family: var(--mono);
  font-size: 0.8125rem;
  text-decoration: none;
  padding: 0.25rem 0.5rem;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.raw:hover { color: var(--accent); border-color: var(--accent); }
main {
  width: min(46rem, 100%);
  margin: 0 auto;
  padding: 1rem max(0.75rem, env(safe-area-inset-right)) 3rem max(0.75rem, env(safe-area-inset-left));
}
article {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(16, 61, 122, 0.04), 0 18px 40px -30px rgba(11, 95, 255, 0.35);
  padding: 1.25rem 1rem 1.75rem;
}
h1, h2, h3 { line-height: 1.3; font-weight: 700; }
h1 { margin: 0 0 0.75rem; font-size: 1.5rem; letter-spacing: -0.01em; }
h2 { margin: 2rem 0 0.5rem; font-size: 1.125rem; padding-top: 1rem; border-top: 1px solid var(--line); }
h1 + h2 { border-top: 0; padding-top: 0; }
h3 { margin: 1.25rem 0 0.35rem; font-size: 1rem; }
p { margin: 0.7rem 0; }
ul, ol { margin: 0.6rem 0; padding-left: 1.2rem; }
li { margin: 0.2rem 0; }
li > ul, li > ol { margin: 0.2rem 0; }
a { color: var(--accent); }
blockquote {
  margin: 0.75rem 0;
  padding-left: 0.75rem;
  border-left: 3px solid var(--line);
  color: var(--muted);
}
code {
  font-family: var(--mono);
  font-size: 0.875em;
  background: var(--soft);
  border: 1px solid var(--line);
  padding: 0.05em 0.3em;
  border-radius: 4px;
  overflow-wrap: anywhere;
}
pre {
  margin: 0.75rem 0;
  padding: 0.85rem 1rem;
  background: var(--soft);
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre code { background: none; border: 0; padding: 0; font-size: 0.8125rem; }
.table-wrap { margin: 0.75rem 0; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
th, td { text-align: left; vertical-align: top; padding: 0.45rem 0.6rem; border-bottom: 1px solid var(--line); }
th { color: var(--dim); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
@media (min-width: 40rem) {
  article { padding: 1.75rem 2rem 2.25rem; }
  h1 { font-size: 1.75rem; }
}
`;

export const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// 一级标题的纯文字。文档没写标题时返回空串，由调用方补自己的默认值。
export function markdownTitle(markdown) {
  let inFence = false;
  for (const line of String(markdown || "").split("\n")) {
    const text = line.trim();
    if (/^(?:```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^#\s+(.+?)\s*$/.exec(text);
    if (match) return match[1];
  }
  return "";
}

// 一级标题之后的第一个正文段落，压成一行当 <meta name="description">。
// 跳过标题、代码块、列表、引用、表格：它们做摘要要么没意义，要么太长。
export function markdownDescription(markdown, { limit = 160 } = {}) {
  const lines = String(markdown || "").split("\n");
  let seenTitle = false;
  let inFence = false;
  const collected = [];
  for (const line of lines) {
    const text = line.trim();
    if (/^(?:```|~~~)/.test(text)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!seenTitle) {
      // 从一级标题之后开始找：标题之前的东西不算简介。
      if (/^#\s+/.test(text)) seenTitle = true;
      continue;
    }
    if (!text) {
      if (collected.length) break;
      continue;
    }
    if (/^[#>`|]/.test(text) || /^[-*+]\s/.test(text) || /^\d+\.\s/.test(text)) {
      if (collected.length) break;
      continue;
    }
    collected.push(text);
  }
  return collected.join(" ").slice(0, limit);
}

// 外链一律带 rel：这些页常常指向别的站点，不该把 opener 留在门户上。
function withSafeLinks(html) {
  return html.replace(/<a href="(https?:\/\/[^"]*)"/g, '<a href="$1" rel="noopener noreferrer"');
}

// 宽表在窄屏上横向滚动，不要把整页撑破。marked 不生成包裹层，这里补。
function withTableWrap(html) {
  return html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");
}

export function markdownHtml(markdown) {
  const marked = new Marked({ gfm: true, breaks: false, mangle: false, headerIds: false });
  return withTableWrap(withSafeLinks(marked.parse(String(markdown || ""))));
}

const DEFAULT_BRAND = { name: "XKnot", mark: "X", href: "/" };

// 文档页骨架。只认参数，不认是哪一份文档：
//   canonical / rawPath  这一页的两个地址（head 里声明，右上角给原文入口）
//   brand                左上角的标识与名称，默认 XKnot
//   lang                 页面语种，默认 zh-CN
// 内容为空时 title 用 brand.name，不渲染空标题。
export function renderDocPage(markdown, options = {}) {
  const {
    canonical = "",
    rawPath = "",
    rawLabel = "Markdown 原文",
    lang = "zh-CN",
    brand = DEFAULT_BRAND,
    style = DEFAULT_STYLE,
    fallbackTitle = "",
  } = options;
  const brandInfo = { ...DEFAULT_BRAND, ...brand };
  const title = markdownTitle(markdown) || fallbackTitle || brandInfo.name;
  // 兜底标题本身就是站名时，不要再拼一次「XKnot · XKnot」。
  const suffix = brandInfo.name && title !== brandInfo.name ? ` · ${brandInfo.name}` : "";
  const description = markdownDescription(markdown);
  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">',
    description ? `<meta name="description" content="${escapeHtml(description)}">` : "",
    `<title>${escapeHtml(title)}${escapeHtml(suffix)}</title>`,
    canonical ? `<link rel="canonical" href="${escapeHtml(canonical)}">` : "",
    rawPath ? `<link rel="alternate" type="text/markdown" href="${escapeHtml(rawPath)}">` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const raw = rawPath
    ? `<a class="raw" href="${escapeHtml(rawPath)}">${escapeHtml(rawLabel)}</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
${head}
<style>${String(style).trim()}</style>
</head>
<body>
<header class="bar">
<a class="brand" href="${escapeHtml(brandInfo.href)}"><span class="mark" aria-hidden="true">${escapeHtml(brandInfo.mark)}</span><span>${escapeHtml(brandInfo.name)}</span></a>
<span class="spacer"></span>
${raw}
</header>
<main>
<article>
${markdownHtml(markdown)}
</article>
</main>
</body>
</html>
`;
}

// 落盘：<out>/<slug>.md 是原文一字不改，<out>/<slug>.html 是渲染结果。
// 原文必须是同一份字节，Agent 不该拿到被 HTML 转义过的副本。
export function writeDocPage({ source, out, slug, ...page }) {
  const markdown = readFileSync(source, "utf8");
  mkdirSync(out, { recursive: true });
  const html = path.join(out, `${slug}.html`);
  writeFileSync(path.join(out, `${slug}.md`), markdown);
  writeFileSync(html, renderDocPage(markdown, page));
  return { html, bytes: Buffer.byteLength(markdown) };
}
