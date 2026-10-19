// Knot 的 Markdown 解析器。块级和行内都解析成节点树，HTML、纯文本、海报文本行
// 由各自的序列化器从同一棵树上取。原生 HTML 不解析成标签，一律当作文本。
//
// 节点：
//   块  heading / paragraph / code / blockquote / list / table / thematicBreak
//   行内 text / code / strong / em / del / link / image / break

const ESCAPABLE = new Set("\\`*_{}[]()#+-.!|~>:");
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const MAX_INLINE_DEPTH = 20;

const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
const SEPARATOR_CELL = /^:?-+:?$/;

export function parse(markdown) {
  const lines = String(markdown ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  return parseBlocks(lines);
}

// ---------------------------------------------------------------- 行内

function runLength(text, index, ch) {
  let run = 1;
  while (text[index + run] === ch) run += 1;
  return run;
}

// 反引号串开启行内代码；只有等长的反引号串才能闭合。
export function codeSpanAt(text, index) {
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

export function linkAt(text, index) {
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
  return { label, url, end: j + 1, image: ch === "!" };
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

function pushText(nodes, value) {
  if (!value) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") {
    last.value += value;
    return;
  }
  nodes.push({ type: "text", value });
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

    const children = parseInline(inner, depth + 1, inLink);
    const end = close.index + len;
    if (len === 3) return { node: { type: "strong", children: [{ type: "em", children }] }, end };
    if (len === 2) {
      return { node: { type: ch === "~" ? "del" : "strong", children }, end };
    }
    return { node: { type: "em", children }, end };
  }
  return null;
}

export function parseInline(text, depth = 0, inLink = false) {
  const src = String(text ?? "");
  const out = [];
  if (depth > MAX_INLINE_DEPTH) {
    pushText(out, src);
    return out;
  }

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\") {
      const next = src[i + 1];
      if (next === "\n") {
        out.push({ type: "break" });
        i += 2;
        continue;
      }
      if (next && ESCAPABLE.has(next)) {
        pushText(out, next);
        i += 2;
        continue;
      }
      pushText(out, "\\");
      i += 1;
      continue;
    }

    if (ch === "\n") {
      if (hardBreakBefore(src, i)) {
        const last = out[out.length - 1];
        if (last?.type === "text") last.value = last.value.replace(/[ \t]+$/, "");
        out.push({ type: "break" });
      } else {
        pushText(out, "\n");
      }
      i += 1;
      continue;
    }

    if (ch === "`") {
      const span = codeSpanAt(src, i);
      if (span) {
        out.push({ type: "code", value: span.value });
        i = span.end;
        continue;
      }
      pushText(out, "`");
      i += 1;
      continue;
    }

    if (ch === "!" || ch === "[") {
      const link = linkAt(src, i);
      // 链接里不能再套链接；图片可以，`[![alt](img)](href)` 是合法的。
      if (link && inLink && !link.image) {
        for (const node of parseInline(link.label, depth + 1, true)) out.push(node);
        i = link.end;
        continue;
      }
      if (link) {
        const url = safeUrl(link.url);
        if (link.image) {
          if (url) out.push({ type: "image", src: url, alt: link.label });
          else pushText(out, link.label);
        } else if (url) {
          out.push({ type: "link", href: url, children: parseInline(link.label, depth + 1, true) });
        } else {
          for (const node of parseInline(link.label, depth + 1, true)) out.push(node);
        }
        i = link.end;
        continue;
      }
    }

    if (ch === "<") {
      const auto = /^<(https?:\/\/[^\s<>]+)>/i.exec(src.slice(i));
      const url = auto ? safeUrl(trimUrlTail(auto[1])) : "";
      if (auto && url && !inLink) {
        const label = trimUrlTail(auto[1]);
        out.push({ type: "link", href: url, children: [{ type: "text", value: label }] });
        i += auto[0].length;
        continue;
      }
      pushText(out, "<");
      i += 1;
      continue;
    }

    if (!inLink && (ch === "h" || ch === "H") && canStartUrl(src, i)) {
      const bare = /^https?:\/\/[^\s<>"'`]+/i.exec(src.slice(i));
      if (bare) {
        const url = trimUrlTail(bare[0]);
        const safe = safeUrl(url);
        if (url && safe) {
          out.push({ type: "link", href: safe, children: [{ type: "text", value: url }] });
          i += url.length;
          continue;
        }
      }
    }

    if (ch === "*" || ch === "_" || ch === "~") {
      const em = emphasisAt(src, i, ch, depth, inLink);
      if (em) {
        out.push(em.node);
        i = em.end;
        continue;
      }
      const run = runLength(src, i, ch);
      pushText(out, src.slice(i, i + run));
      i += run;
      continue;
    }

    pushText(out, ch);
    i += 1;
  }
  return out;
}

// ---------------------------------------------------------------- 链接

export function safeUrl(raw) {
  const value = String(raw || "").trim().replace(/^<|>$/g, "");
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
  } catch {
    /* 相对路径在站点内是合法的 */
  }
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  if (/^#[^#\s]+$/.test(value)) return value;
  return "";
}

// ---------------------------------------------------------------- 块级

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

export function splitRow(line) {
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

export function isSeparatorRow(line) {
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
  const header = splitRow(lines[index]).map((cell) => parseInline(cell));
  const aligns = splitRow(lines[index + 1]).map(alignOf);
  const rows = [];
  let i = index + 2;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || !line.includes("|") || LIST_ITEM.test(line)) break;
    rows.push(splitRow(line).map((cell) => parseInline(cell)));
    i += 1;
  }
  return { node: { type: "table", header, aligns, rows }, end: i };
}

function atxHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
  if (!match) return null;
  const text = (match[2] || "").replace(/[ \t]+#+[ \t]*$/, "").trim();
  return { level: match[1].length, text };
}

export function isHr(line) {
  return /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(line);
}

export function setextLevel(line) {
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

    items.push({ blocks: parseBlocks(body), task });

    const sibling = LIST_ITEM.exec(lines[i] || "");
    if (!sibling || indentOf(lines[i]) !== baseIndent) break;
    if ((/^\d/.test(sibling[2]) ? "ol" : "ul") !== type) break;
  }

  return { node: { type: "list", ordered, start, tight: !loose, items }, end: i };
}

function parseBlocks(lines) {
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
      out.push({ type: "code", language, text: code.join("\n") });
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const table = tableAt(lines, i);
    if (table) {
      out.push(table.node);
      i = table.end;
      continue;
    }

    const heading = atxHeading(line);
    if (heading) {
      out.push({ type: "heading", level: heading.level, children: parseInline(heading.text) });
      i += 1;
      continue;
    }

    if (isHr(line)) {
      out.push({ type: "thematicBreak" });
      i += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^ {0,3}>/.test(lines[i])) {
        quote.push(lines[i].replace(/^ {0,3}> ?/, ""));
        i += 1;
      }
      out.push({ type: "blockquote", blocks: parseBlocks(quote) });
      continue;
    }

    const list = listAt(lines, i);
    if (list) {
      out.push(list.node);
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
      out.push({ type: "heading", level, children: parseInline(paragraph.join("\n")) });
      i += 1;
    } else {
      out.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
    }
  }

  return out;
}
