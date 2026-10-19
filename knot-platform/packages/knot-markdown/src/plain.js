import { codeSpanAt, isHr, isSeparatorRow, linkAt, setextLevel, splitRow } from "./parse.js";

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
      out += stripLinks(at.label);
      i = at.end;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

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

// 折叠预览、通知、我的投稿这些地方只要文字：去掉标记，保留分行。
export function toPlain(text) {
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

// 从节点树取纯文字，标题、表格、引用都摊平。
export function textOf(nodes, separator = "") {
  const parts = [];
  for (const node of nodes || []) {
    switch (node.type) {
      case "text":
        parts.push(node.value);
        break;
      case "code":
        parts.push(node.value);
        break;
      case "break":
        parts.push(" ");
        break;
      case "image":
        parts.push(node.alt);
        break;
      case "link":
      case "strong":
      case "em":
      case "del":
        parts.push(textOf(node.children, separator));
        break;
      default:
        break;
    }
  }
  return parts.join(separator);
}

// 下载包名取正文的第一个有效行。Markdown 标记先剥掉，`# 报价说明` 得 `报价说明`。
export function firstLine(text) {
  const line = toPlain(text)
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || "";
}
