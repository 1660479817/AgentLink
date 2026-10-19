import { documentDescription, documentTitle, escapeHtml, toHtml } from "@knot/markdown";

const PAGE_STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #f0f2f5;
  color: #050505;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, "Noto Sans SC", sans-serif;
  font-size: 1rem;
  line-height: 1.55;
}
.bar {
  position: sticky;
  top: 0;
  z-index: 1;
  height: 56px;
  display: flex;
  align-items: center;
  padding: 0 max(1rem, env(safe-area-inset-left));
  background: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}
.brand {
  display: inline-flex;
  text-decoration: none;
}
.mark {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  background: #0866ff;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 1.25rem;
  line-height: 1;
}
main {
  width: min(42rem, 100%);
  margin: 0 auto;
  padding: 1rem max(0.75rem, env(safe-area-inset-right)) 2.5rem max(0.75rem, env(safe-area-inset-left));
}
article {
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  padding: 1.15rem 1rem 1.5rem;
}
h1, h2, h3 { line-height: 1.3; font-weight: 700; }
h1 { margin: 0 0 0.75rem; font-size: 1.375rem; }
h2 { margin: 1.75rem 0 0.5rem; font-size: 1.0625rem; }
h3 { margin: 1.25rem 0 0.4rem; font-size: 1rem; }
p { margin: 0.65rem 0; }
ul, ol { margin: 0.5rem 0; padding-left: 1.15rem; }
li { margin: 0.15rem 0; }
li > ul, li > ol { margin: 0.15rem 0; }
blockquote {
  margin: 0.75rem 0;
  padding-left: 0.75rem;
  border-left: 3px solid #e4e6eb;
  color: #65676b;
}
a { color: #0866ff; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em;
  background: #f0f2f5;
  padding: 0.1em 0.35em;
  border-radius: 4px;
}
pre {
  margin: 0.75rem 0;
  padding: 0.85rem 1rem;
  background: #f0f2f5;
  border-radius: 8px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre code { background: none; padding: 0; font-size: 0.8125rem; }
.table-wrap { margin: 0.75rem 0; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
th, td {
  text-align: left;
  vertical-align: top;
  padding: 0.45rem 0.55rem;
  border-bottom: 1px solid #e4e6eb;
}
th { color: #65676b; font-weight: 600; }
@media (min-width: 40rem) {
  article { padding: 1.5rem 1.75rem 2rem; }
}
`;

export function wantsHelpHtml(accept) {
  let html = 0;
  let markdown = 0;
  for (const part of String(accept || "").split(",")) {
    const [rawType, ...params] = part.trim().split(";").map((item) => item.trim());
    if (!rawType) continue;
    let quality = 1;
    for (const param of params) {
      const match = /^q=([0-9.]+)$/i.exec(param);
      if (match) quality = Number(match[1]);
    }
    if (!Number.isFinite(quality)) quality = 0;
    quality = Math.min(1, Math.max(0, quality));
    const type = rawType.toLowerCase();
    if (type === "text/html") html = Math.max(html, quality);
    if (type === "text/markdown") markdown = Math.max(markdown, quality);
  }
  return html > 0 && html > markdown;
}

export function renderHelp(markdown, accept) {
  if (wantsHelpHtml(accept)) {
    return { contentType: "text/html; charset=utf-8", body: helpDocument(markdown) };
  }
  return { contentType: "text/markdown; charset=utf-8", body: String(markdown) };
}

// 和 WebUI 用同一份解析器。页面上标题最多到 h3，表格沿用 .table-wrap 的横向滚动。
export function helpDocument(markdown) {
  const title = documentTitle(markdown) || "Knot";
  const description = documentDescription(markdown);
  const body = toHtml(markdown, { maxHeading: 3, tableClass: "table-wrap" });
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<meta name="description" content="${escapeHtml(description)}">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="bar">
<a class="brand" href="/" aria-label="Knot"><span class="mark" aria-hidden="true">K</span></a>
</header>
<main>
<article>
${body}
</article>
</main>
</body>
</html>
`;
}
