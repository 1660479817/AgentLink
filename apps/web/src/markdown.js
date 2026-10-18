// Minimal, dependency-free Markdown detection and rendering for card bodies.
// Safety rule: everything is escaped by default; we only emit a fixed set of
// whitelisted tags and only allow http/https (or fragment) links. Raw HTML in
// the source is treated as text and escaped, so it can never be injected.

const HINTS = [
  /^#{1,6}[ \t]+/m, // heading
  /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/m, // list item
  /\*\*[^*]+\*\*/, // **bold**
  /__[^_]+__/, // __bold__
  /`[^`\n]+`/, // `code`
  /^[ \t]*(?:```|~~~)/m, // fenced code block
  /^[ \t]*>[ \t]?/m, // blockquote
  /\[[^\]\n]+\]\([^)\s]+\)/, // [text](url)
  /~~[^~\n]+~~/, // ~~strike~~
  /(^|[^\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_])/mu, // _italic_
  /https?:\/\/[^\s<>]+/i, // bare link
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/m, // table delimiter row
  /^[ \t]*\S[^\n]*\n[ \t]*(?:=+|-+)[ \t]*$/m, // setext heading
];

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!|~>:");
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MAX_INLINE_DEPTH = 20;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeUrl(raw) {
  const value = String(raw || "").trim().replace(/^<|>$/g, "");
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    /* not an absolute URL */
  }
  if (/^#[^#\s]+$/.test(value)) return value; // fragment-only anchor
  return "";
}

function runLength(text, index, ch) {
  let run = 1;
  while (text[index + run] === ch) run += 1;
  return run;
}

// A backtick run opens a code span; only a closing run of the same length ends it.
function codeSpanAt(text, index) {
  const open = /^`+/.exec(text.slice(index));
  if (!open) return null;
  const marker = open[0];
  let cursor = index + marker.length;
  while (cursor < text.length) {
    const found = text.indexOf(marker, cursor);
    if (found < 0) return null;
    let run = 1;
    while (text[found + run] === "`") run += 1;
    if (run > marker.length) {
      cursor = found + run;
      continue;
    }
    let value = text.slice(index + marker.length, found);
    if (/^ .* $/.test(value) && value.trim()) value = value.slice(1, -1);
    return { value, end: found + marker.length };
  }
  return null;
}

function linkAt(text, index) {
  const ch = text[index];
  if (ch !== "[" && ch !== "!") return null;
  if (index > 0 && text[index - 1] === "\\") return null;
  let i = index;
  if (ch === "!") i += 1;
  if (text[i] !== "[") return null;

  let depth = 1;
  let labelEnd = -1;
  for (let j = i + 1; j < text.length; j += 1) {
    if (text[j] === "\\") {
      j += 1;
      continue;
    }
    if (text[j] === "[") depth += 1;
    if (text[j] === "]") {
      depth -= 1;
      if (depth === 0) {
        labelEnd = j;
        break;
      }
    }
  }
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") return null;
  const label = text.slice(i + 1, labelEnd);

  // Scan the URL, allowing balanced parentheses inside it.
  let paren = 1;
  let j = labelEnd + 2;
  let href = "";
  while (j < text.length && paren > 0) {
    const c = text[j];
    if (c === "\\" && text[j + 1]) {
      href += text[j + 1];
      j += 2;
      continue;
    }
    if (c === "(") paren += 1;
    if (c === ")") {
      paren -= 1;
      if (paren === 0) break;
    }
    href += c;
    j += 1;
  }
  if (paren !== 0) return null;
  const url = href.trim().split(/\s+/)[0].replace(/^<|>$/g, "");
  return { label, url, end: j + 1 };
}

function countChar(text, ch) {
  let count = 0;
  for (const c of text) {
    if (c === ch) count += 1;
  }
  return count;
}

function trimUrlTail(raw) {
  let url = raw;
  while (url.length > 1) {
    const last = url[url.length - 1];
    if (/[.,;:!?。，；：！？、*~]/.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === ")" && countChar(url, "(") < countChar(url, ")")) {
      url = url.slice(0, -1);
      continue;
    }
    if (last === "]" && countChar(url, "[") < countChar(url, "]")) {
      url = url.slice(0, -1);
      continue;
    }
    if (/[）】》」』]/.test(last)) {
      url = url.slice(0, -1);
      continue;
    }
    break;
  }
  return url;
}

function canStartUrl(text, index) {
  if (index === 0) return true;
  const prev = text[index - 1];
  return /[\s([{<"'“‘（【《]/.test(prev) || /[，。；：！？、]/.test(prev);
}

function hardBreakBefore(text, index) {
  return /(?: {2,}|\\)$/.test(text.slice(Math.max(0, index - 40), index));
}

// Finds a closing delimiter run for emphasis, skipping escapes and code spans.
function findClose(text, from, ch, len) {
  let j = from;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === "`") {
      const span = codeSpanAt(text, j);
      j = span ? span.end : j + 1;
      continue;
    }
    if (c === ch) {
      const run = runLength(text, j, ch);
      if (run >= len) {
        const prev = text[j - 1];
        const after = text[j + len];
        const cleanPrev = prev && !/\s/.test(prev);
        const cleanAfter = ch !== "_" || !after || !WORD_CHAR.test(after);
        if (cleanPrev && cleanAfter) return { index: j };
      }
      j += run;
      continue;
    }
    j += 1;
  }
  return null;
}

function emphasisAt(text, index, ch, depth, inLink) {
  const run = runLength(text, index, ch);
  if (ch === "~" && run < 2) return null;
  const max = ch === "~" ? 2 : Math.min(run, 3);
  const min = ch === "~" ? 2 : 1;
  const prev = text[index - 1];

  for (let len = max; len >= min; len -= 1) {
    const start = index + len;
    const first = text[start];
    if (!first || /\s/.test(first)) continue;
    if (ch === "_" && prev && WORD_CHAR.test(prev)) continue;

    const close = findClose(text, start, ch, len);
    if (!close) continue;
    const inner = text.slice(start, close.index);
    if (!inner.trim()) continue;

    const body = renderInline(inner, depth + 1, inLink);
    const end = close.index + len;
    if (len === 3) return { html: `<strong><em>${body}</em></strong>`, end };
    if (len === 2) return { html: ch === "~" ? `<del>${body}</del>` : `<strong>${body}</strong>`, end };
    return { html: `<em>${body}</em>`, end };
  }
  return null;
}

function renderInline(text, depth = 0, inLink = false) {
  const src = String(text ?? "");
  if (depth > MAX_INLINE_DEPTH) return escapeHtml(src);

  let out = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        out += "<br>";
        i += 2;
        continue;
      }
      if (next && ESCAPABLE.has(next)) {
        out += escapeHtml(next);
        i += 2;
        continue;
      }
      out += "\\";
      i += 1;
      continue;
    }

    if (ch === "\n") {
      if (hardBreakBefore(src, i)) {
        out = out.replace(/[ \t]+$/, "");
        out += "<br>";
      } else {
        out += "\n";
      }
      i += 1;
      continue;
    }

    if (ch === "`") {
      const span = codeSpanAt(src, i);
      if (span) {
        out += `<code>${escapeHtml(span.value)}</code>`;
        i = span.end;
        continue;
      }
      out += "`";
      i += 1;
      continue;
    }

    if (ch === "!" || ch === "[") {
      const link = linkAt(src, i);
      if (link && inLink) {
        out += renderInline(link.label, depth + 1, true);
        i = link.end;
        continue;
      }
      if (link) {
        const url = safeUrl(link.url);
        if (url) {
          const label = renderInline(link.label, depth + 1, true) || escapeHtml(url);
          out += `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${label}</a>`;
          i = link.end;
          continue;
        }
        if (ch === "[") {
          out += renderInline(link.label, depth + 1, true);
          i = link.end;
          continue;
        }
      }
    }

    if (ch === "<") {
      const auto = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i));
      const url = auto ? safeUrl(trimUrlTail(auto[1])) : "";
      if (auto && url && !inLink) {
        const label = trimUrlTail(auto[1]);
        out += `<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(label)}</a>`;
        i += auto[0].length;
        continue;
      }
      out += "&lt;";
      i += 1;
      continue;
    }

    if (!inLink && (ch === "h" || ch === "H") && canStartUrl(src, i)) {
      const bare = /^https?:\/\/[^\s<>"'`]+/i.exec(src.slice(i));
      if (bare) {
        const url = trimUrlTail(bare[0]);
        const safe = safeUrl(url);
        if (url && safe) {
          out += `<a href="${escapeHtml(safe)}" rel="noopener noreferrer" target="_blank">${escapeHtml(url)}</a>`;
          i += url.length;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const em = emphasisAt(src, i, ch, depth, inLink);
      if (em) {
        out += em.html;
        i = em.end;
        continue;
      }
      const run = runLength(src, i, ch);
      out += escapeHtml(src.slice(i, i + run));
      i += run;
      continue;
    }

    out += escapeHtml(ch);
    i += 1;
  }
  return out;
}

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const SEPARATOR_CELL = /^:?-+:?$/;

function indentOf(line) {
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

// Splits a table row on pipes, honouring `\|` escapes and inline code spans.
function splitRow(line) {
  let row = String(line || "").trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  const cells = [];
  let cell = "";
  let ticks = 0;

  for (let i = 0; i < row.length; i += 1) {
    const c = row[i];
    if (c === "\\" && row[i + 1] === "|") {
      cell += "|";
      i += 1;
      continue;
    }
    if (c === "`") {
      let run = 1;
      while (row[i + run] === "`") run += 1;
      if (ticks === 0) ticks = run;
      else if (ticks === run) ticks = 0;
      cell += row.slice(i, i + run);
      i += run - 1;
      continue;
    }
    if (c === "|" && ticks === 0) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += c;
  }
  cells.push(cell.trim());
  return cells;
}

function isSeparatorRow(line) {
  if (!String(line || "").includes("|")) return false;
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL.test(cell));
}

function alignOf(cell) {
  const value = String(cell || "").trim();
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "";
}

function isTableStart(lines, index) {
  const head = lines[index];
  const separator = lines[index + 1];
  if (!head || !head.includes("|") || !isSeparatorRow(separator)) return false;
  return splitRow(head).length === splitRow(separator).length;
}

function tableAt(lines, index) {
  if (!isTableStart(lines, index)) return null;
  const header = splitRow(lines[index]);
  const aligns = splitRow(lines[index + 1]).map(alignOf);
  const rows = [];
  let i = index + 2;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || !line.includes("|") || LIST_ITEM.test(line)) break;
    rows.push(splitRow(line));
    i += 1;
  }
  return { header, aligns, rows, end: i };
}

function renderTable({ header, aligns, rows }) {
  const cell = (tag, value, align) => {
    const cls = align ? ` class="md-${align}"` : "";
    return `<${tag}${cls}>${renderInline(value || "")}</${tag}>`;
  };
  const head = header.map((value, index) => cell("th", value, aligns[index])).join("");
  const body = rows
    .map((row) => `<tr>${header.map((_, index) => cell("td", row[index] || "", aligns[index])).join("")}</tr>`)
    .join("");
  return `<div class="md-table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function atxHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
  if (!match) return null;
  const text = (match[2] || "").replace(/[ \t]+#+[ \t]*$/, "").trim();
  return { level: match[1].length, text };
}

function isHr(line) {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

function setextLevel(line) {
  if (/^[ \t]*=+[ \t]*$/.test(line)) return 1;
  if (/^[ \t]*-+[ \t]*$/.test(line)) return 2;
  return 0;
}

function isBlockStart(lines, index) {
  const line = lines[index];
  return (
    /^[ \t]*(?:`{3,}|~{3,})/.test(line) ||
    Boolean(atxHeading(line)) ||
    isHr(line) ||
    /^ {0,3}>/.test(line) ||
    LIST_ITEM.test(line) ||
    isTableStart(lines, index)
  );
}

function listAt(lines, index) {
  const first = LIST_ITEM.exec(lines[index]);
  if (!first) return null;

  const baseIndent = indentOf(lines[index]);
  const ordered = /^\d/.test(first[2]);
  const type = ordered ? "ol" : "ul";
  const start = ordered ? Number(first[2].slice(0, -1)) : 1;
  const items = [];
  let loose = false;
  let i = index;

  while (i < lines.length) {
    const marker = LIST_ITEM.exec(lines[i]);
    if (!marker) break;
    if (indentOf(lines[i]) !== baseIndent) break;
    if ((/^\d/.test(marker[2]) ? "ol" : "ul") !== type) break;

    const contentIndent = baseIndent + marker[2].length + Math.max(1, marker[3].length);
    const body = [marker[4]];
    let task = null;
    const checkbox = /^\[([ xX])\](?:[ \t]+|$)/.exec(body[0]);
    if (checkbox) {
      task = checkbox[1].toLowerCase() === "x";
      body[0] = body[0].slice(checkbox[0].length);
    }
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
        const peekIndent = indentOf(peek);
        if (peekItem && peekIndent === baseIndent && /^\d/.test(peekItem[2]) === ordered) {
          loose = true;
          i = next;
          break;
        }
        if (peekIndent > baseIndent) {
          loose = true;
          body.push("");
          i += 1;
          continue;
        }
        i = next;
        break;
      }

      const lineIndent = indentOf(line);
      if (lineIndent <= baseIndent) break;
      body.push(removeIndent(line, contentIndent));
      i += 1;
    }

    items.push({ lines: body, task });

    const sibling = LIST_ITEM.exec(lines[i] || "");
    if (!sibling || indentOf(lines[i]) !== baseIndent) break;
    if ((/^\d/.test(sibling[2]) ? "ol" : "ul") !== type) break;
  }

  const tight = !loose;
  const rendered = items.map((item) => {
    let content = renderBlocks(item.lines);
    if (tight) content = content.replace(/^<p>([\s\S]*?)<\/p>/, "$1");
    const box = item.task === null ? "" : `<input type="checkbox" disabled${item.task ? " checked" : ""} aria-hidden="true"> `;
    const cls = item.task === null ? "" : ' class="md-task"';
    return `<li${cls}>${box}${content}</li>`;
  });
  const tag = ordered ? "ol" : "ul";
  const attrs = [
    ordered && start !== 1 ? ` start="${start}"` : "",
    items.some((item) => item.task !== null) ? ' class="md-tasks"' : "",
  ].join("");
  return { html: `<${tag}${attrs}>${rendered.join("")}</${tag}>`, end: i };
}

function renderBlocks(lines) {
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const language = line.slice(fence[0].length).trim();
      const code = [];
      i += 1;
      while (i < lines.length) {
        const close = /^[ \t]*(`{3,}|~{3,})/.exec(lines[i]);
        if (close && close[1][0] === marker && close[1].length >= length) {
          i += 1;
          break;
        }
        code.push(lines[i]);
        i += 1;
      }
      const langAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
      out.push(`<pre><code${langAttr}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      out.push(renderTable(table));
      i = table.end;
      continue;
    }

    const heading = atxHeading(line);
    if (heading) {
      out.push(`<h${heading.level}>${renderInline(heading.text)}</h${heading.level}>`);
      i += 1;
      continue;
    }

    if (isHr(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        quote.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderBlocks(quote)}</blockquote>`);
      continue;
    }

    const list = listAt(lines, i);
    if (list) {
      out.push(list.html);
      i = list.end;
      continue;
    }

    const paragraph = [];
    while (i < lines.length) {
      const current = lines[i];
      if (!current.trim()) break;
      if (paragraph.length && setextLevel(current)) break;
      if (isBlockStart(lines, i)) break;
      paragraph.push(current);
      i += 1;
    }
    if (!paragraph.length) {
      paragraph.push(line);
      i += 1;
    }

    const level = setextLevel(lines[i] || "");
    if (level) {
      out.push(`<h${level}>${renderInline(paragraph.join("\n"))}</h${level}>`);
      i += 1;
    } else {
      out.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
    }
  }

  return out.join("");
}

export function isMarkdown(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  return HINTS.some((hint) => hint.test(value));
}

export function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  return renderBlocks(lines);
}

function stripLinks(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\") {
      out += text.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const span = codeSpanAt(text, i);
      if (span) {
        out += `\`${span.value}\``;
        i = span.end;
        continue;
      }
    }
    const at = linkAt(text, i);
    if (at) {
      out += at.label;
      i = at.end;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

// Drops table rows and their delimiter, leaving the cell text behind.
function stripTables(text) {
  const lines = String(text).split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const next = lines[i + 1];
    if (lines[i].includes("|") && next && isSeparatorRow(next)) {
      out.push(splitRow(lines[i]).join(" "));
      i += 1;
      while (i + 1 < lines.length && lines[i + 1].includes("|") && lines[i + 1].trim()) {
        i += 1;
        out.push(splitRow(lines[i]).join(" "));
      }
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}

// Strips the common Markdown markers so the collapsed preview reads cleanly.
export function plainMarkdown(text) {
  let body = String(text || "").replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "");
  body = stripTables(body);

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const kept = [];
  for (const raw of lines) {
    if (isHr(raw) || setextLevel(raw)) continue;
    const line = raw
      .replace(/^[ \t]*#{1,6}[ \t]+/, "")
      .replace(/[ \t]+#+[ \t]*$/, "")
      .replace(/^[ \t]*>[ \t]?/, "")
      .replace(/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/, "")
      .replace(/^\[[ xX]\][ \t]+/, "")
      .trim();
    kept.push(line);
  }

  const tokens = [];
  const guard = (value) =>
    value.replace(/\\([\\`*_{}[\]()#+\-.!|~>:])/g, (_, ch) => {
      tokens.push(ch);
      return `\u0000${tokens.length - 1}\u0000`;
    });
  const restore = (value) => value.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] ?? "");

  const stripped = guard(kept.join("\n"))
    .replace(/`+/g, "")
    .replace(/<(https?:\/\/[^>\s]+)>/g, "$1");
  const plain = stripLinks(stripped)
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(^|[^\p{L}\p{N}_*])\*([^*\n]+)\*/gu, "$1$2")
    .replace(/(^|[^\p{L}\p{N}_])_([^_\n]+)_(?![\p{L}\p{N}_])/gu, "$1$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return restore(plain);
}
