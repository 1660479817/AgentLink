import { parse } from "./parse.js";

// 一棵解析树，三种出口：HTML、纯文本、海报文字行。
export { parse } from "./parse.js";
export { escapeHtml, toHtml } from "./html.js";
export { firstLine, toPlain } from "./plain.js";
export { toRuns } from "./runs.js";

// 只在正文里出现真正的标记时才算 Markdown。普通的句子、`snake_case` 不算。
const HINTS = [
  /^#{1,6}[ \t]+/m,
  /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/m,
  /\*\*[^*]+\*\*/,
  /__[^_]+__/,
  /`[^`\n]+`/,
  /^[ \t]*(?:```|~~~)/m,
  /^[ \t]*>[ \t]?/m,
  /!\[[^\]\n]*\]\([^)\n]+\)/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /~~[^~\n]+~~/,
  /(^|[^\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_])/mu,
  /https?:\/\/[^\s<>]+/i,
  /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/m,
  /^[ \t]*\S[^\n]*\n[ \t]*(?:=+|-+)[ \t]*$/m,
];

export function isMarkdown(text) {
  const value = String(text || "");
  if (!value.trim()) return false;
  return HINTS.some((hint) => hint.test(value));
}

// 卡片里有图片时直接展开，不让人再多点一次「更多」。按解析树判断，
// 代码块里写出来的 `![x](y)` 不会被当成图片。
export function containsImage(input) {
  const blocks = typeof input === "string" ? parse(input) : input;
  const inNodes = (nodes) =>
    (nodes || []).some((node) => node.type === "image" || (node.children && inNodes(node.children)));
  const inBlocks = (list) =>
    (list || []).some((block) => {
      if (block.type === "code" || block.type === "thematicBreak") return false;
      if (block.type === "table") {
        return [...block.header, ...block.rows.flat()].some(inNodes);
      }
      if (block.type === "list") return block.items.some((item) => inBlocks(item.blocks));
      if (block.type === "blockquote") return inBlocks(block.blocks);
      return inNodes(block.children);
    });
  return inBlocks(blocks);
}
