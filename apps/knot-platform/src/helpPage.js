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

export function helpDocument(markdown) {
  const doc = renderMarkdown(markdown);
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no">
<meta name="description" content="${escapeHtml(doc.description)}">
<title>${escapeHtml(doc.title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header class="bar">
<a class="brand" href="/" aria-label="Knot"><span class="mark" aria-hidden="true">K</span></a>
</header>
<main>
<article>
${doc.body}
</article>
</main>
</body>
</html>
`;
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  return {
    title: documentTitle(lines),
    description: documentDescription(lines),
    body: renderBlocks(lines),
  };
}

function documentTitle(lines) {
  for (const line of lines) {
    const heading = /^#[ \t]+(.*\S)\s*$/.exec(line);
    if (heading) return plain(heading[1]);
  }
  return "Knot";
}

function documentDescription(lines) {
  let fenced = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^[ \t]*(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || !line.trim()) continue;
    if (/^ {0,3}#{1,6}[ \t]+/.test(line)) continue;
    if (LIST_ITEM.test(line)) continue;
    if (/^ {0,3}>/.test(line)) continue;
    if (isSeparator(line) || isTableStart(lines, i)) continue;
    return plain(line);
  }
  return "";
}

function renderBlocks(lines) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (/^[ \t]*(?:```|~~~)/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^[ \t]*(?:```|~~~)/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const rows = [splitRow(lines[i])];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i += 1;
      }
      blocks.push(renderTable(rows));
      continue;
    }

    const heading = /^ {0,3}(#{1,3})[ \t]+(.*\S)[ \t]*$/.exec(line);
    if (heading) {
      blocks.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const list = renderList(lines, i);
      blocks.push(list.html);
      i = list.end;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        quote.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i += 1;
      }
      blocks.push(`<blockquote>${renderBlocks(quote)}</blockquote>`);
      continue;
    }

    const para = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines, i)) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (!para.length) {
      para.push(line.trim());
      i += 1;
    }
    blocks.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return blocks.join("\n");
}

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;

function startsBlock(lines, index) {
  const line = lines[index];
  return (
    /^[ \t]*(?:```|~~~)/.test(line) ||
    /^ {0,3}#{1,3}[ \t]+/.test(line) ||
    /^ {0,3}>/.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(lines, index)
  );
}

function indentWidth(line) {
  const lead = /^[ \t]*/.exec(line)[0];
  let width = 0;
  for (const c of lead) width += c === "\t" ? 4 : 1;
  return width;
}

function removeIndent(line, columns) {
  let removed = 0;
  let i = 0;
  while (i < line.length && removed < columns) {
    if (line[i] === " ") {
      removed += 1;
      i += 1;
      continue;
    }
    if (line[i] === "\t") {
      removed += 4;
      i += 1;
      continue;
    }
    break;
  }
  return line.slice(i);
}

function renderList(lines, index) {
  const first = LIST_ITEM.exec(lines[index]);
  const base = indentWidth(lines[index]);
  const ordered = /^\d/.test(first[2]);
  const startAt = ordered ? Number(first[2].slice(0, -1)) : 1;
  const items = [];
  let loose = false;
  let i = index;

  while (i < lines.length) {
    const marker = LIST_ITEM.exec(lines[i]);
    if (!marker) break;
    if (indentWidth(lines[i]) !== base) break;
    if (/^\d/.test(marker[2]) !== ordered) break;

    const contentIndent = base + marker[2].length + Math.max(1, marker[3].length);
    const body = [marker[4]];
    i += 1;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        let next = i + 1;
        while (next < lines.length && !lines[next].trim()) next += 1;
        if (next >= lines.length) {
          i = next;
          break;
        }
        const peek = lines[next];
        const peekItem = LIST_ITEM.exec(peek);
        if (peekItem && indentWidth(peek) === base && /^\d/.test(peekItem[2]) === ordered) {
          loose = true;
          i = next;
          break;
        }
        if (indentWidth(peek) > base) {
          loose = true;
          body.push("");
          i += 1;
          continue;
        }
        i = next;
        break;
      }
      if (indentWidth(line) <= base) break;
      body.push(removeIndent(line, contentIndent));
      i += 1;
    }

    items.push(body);

    const sibling = LIST_ITEM.exec(lines[i] || "");
    if (!sibling || indentWidth(lines[i]) !== base) break;
    if (/^\d/.test(sibling[2]) !== ordered) break;
  }

  const tag = ordered ? "ol" : "ul";
  const start = ordered && startAt !== 1 ? ` start="${startAt}"` : "";
  const html = items
    .map((body) => {
      const nested = body.some((line, position) => position > 0 && (LIST_ITEM.test(line) || /^ {0,3}>/.test(line)));
      let content;
      if (!loose && !nested) {
        content = inline(body.join(" ").trim());
      } else {
        content = renderBlocks(body);
        if (!loose) content = content.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
      }
      return `<li>${content}</li>`;
    })
    .join("");
  return { html: `<${tag}${start}>${html}</${tag}>`, end: i };
}

function isTableStart(lines, index) {
  return Boolean(lines[index]?.includes("|") && lines[index + 1] && isSeparator(lines[index + 1]));
}

function isSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  let cells = line.trim();
  if (cells.startsWith("|")) cells = cells.slice(1);
  if (cells.endsWith("|")) cells = cells.slice(0, -1);
  return cells.split("|").map((cell) => cell.trim());
}

function renderTable(rows) {
  const [head, ...body] = rows;
  const headHtml = head.map((cell) => `<th>${inline(cell)}</th>`).join("");
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`)
    .join("");
  return `<div class="table-wrap"><table><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
}

function inline(text) {
  return String(text)
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

function plain(text) {
  return String(text).replace(/`([^`]+)`/g, "$1").replace(/\s+/g, " ").trim();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
