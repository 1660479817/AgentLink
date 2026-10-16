// Minimal, dependency-free Markdown detection and rendering for card bodies.
// Safety rule: everything is escaped by default; we only emit a fixed set of
// whitelisted tags and only allow http/https (or fragment) links. Raw HTML in
// the source is treated as text and escaped, so it can never be injected.

const HINTS = [
  /^#{1,6}\s+/m, // heading
  /^\s*(?:[-*+]|1[.)])\s+/m, // list item
  /\*\*[^*]+\*\*/, // **bold**
  /__[^_]+__/, // __bold__
  /`[^`\n]+`/, // `code`
  /^```/m, // fenced code block
  /^\s*>\s+/m, // blockquote
  /\[[^\]\n]+\]\([^)\s]+\)/, // [text](url)
];

const PLACEHOLDER = "\u0000";

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

function linkAt(text, index) {
  const ch = text[index];
  if (ch !== "[" && ch !== "!") return null;
  let i = index;
  if (ch === "!") i += 1;
  if (text[i] !== "[") return null;
  const labelEnd = text.indexOf("]", i + 1);
  if (labelEnd < 0 || text[labelEnd + 1] !== "(") return null;
  const label = text.slice(i + 1, labelEnd);

  // Scan the URL, allowing balanced parentheses inside it.
  let depth = 1;
  let j = labelEnd + 2;
  let href = "";
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (depth === 0) break;
    href += c;
    j += 1;
  }
  if (depth !== 0) return null;
  const url = href.trim().split(/\s+/)[0];
  return { label, url, end: j + 1 };
}

function renderInline(text) {
  const tokens = [];
  const stash = (html) => {
    tokens.push(html);
    return `${PLACEHOLDER}${tokens.length - 1}${PLACEHOLDER}`;
  };

  let out = String(text);

  // Inline code spans first so their contents are never re-parsed.
  out = out.replace(/`([^`\n]+)`/g, (_, code) => stash(`<code>${escapeHtml(code)}</code>`));

  // Links and images (images become plain links; cards render media separately).
  let linked = "";
  let i = 0;
  while (i < out.length) {
    const at = linkAt(out, i);
    if (at) {
      const url = safeUrl(at.url);
      const label = escapeHtml(at.label || url);
      linked += url ? stash(`<a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${label}</a>`) : label;
      i = at.end;
    } else {
      linked += out[i];
      i += 1;
    }
  }
  out = linked;

  // Escape everything that remains, then apply emphasis on the escaped text.
  out = escapeHtml(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");

  // Restore placeholders, resolving any nested references (labels may hold code spans).
  const restore = new RegExp(`${PLACEHOLDER}(\\d+)${PLACEHOLDER}`, "g");
  let restored = out;
  for (let guard = 0; guard <= tokens.length; guard += 1) {
    const next = restored.replace(restore, (_, index) => tokens[Number(index)] || "");
    if (next === restored) break;
    restored = next;
  }
  return restored;
}

function isBlockStart(line) {
  return (
    /^\s*(```+|~~~+)/.test(line) ||
    /^#{1,6}\s/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*(?:[-*+]|1[.)])\s/.test(line)
  );
}

export function isMarkdown(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  return HINTS.some((hint) => hint.test(value));
}

export function renderMarkdown(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*(```+|~~~+)/);
    if (fence) {
      const marker = fence[1][0];
      const length = fence[1].length;
      const language = line.slice(fence[0].length).trim();
      const code = [];
      i += 1;
      while (i < lines.length) {
        const close = lines[i].match(/^\s*(`{3,}|~{3,})/);
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

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }

    const unordered = line.match(/^\s*([-*+])\s+(.*)$/);
    const ordered = line.match(/^\s*1[.)]\s+(.*)$/);
    if (unordered || ordered) {
      const tag = unordered ? "ul" : "ol";
      const items = [];
      while (i < lines.length) {
        const ul = lines[i].match(/^\s*([-*+])\s+(.*)$/);
        const ol = lines[i].match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (tag === "ul" && ul) {
          items.push(`<li>${renderInline(ul[2])}</li>`);
          i += 1;
          continue;
        }
        if (tag === "ol" && ol) {
          items.push(`<li>${renderInline(ol[2])}</li>`);
          i += 1;
          continue;
        }
        break;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    if (paragraph.length) out.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }

  return out.join("");
}

function stripLinks(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const at = linkAt(text, i);
    if (at) {
      out += at.label;
      i = at.end;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

// Strips the common Markdown markers so the collapsed preview reads cleanly.
export function plainMarkdown(text) {
  const stripped = String(text || "")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return stripLinks(stripped);
}
