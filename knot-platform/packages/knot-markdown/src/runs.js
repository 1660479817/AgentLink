import { parse } from "./parse.js";

const EMPTY_STYLE = { bold: false, italic: false, code: false, link: "" };

// 海报要的是一行一行带样式的文字，不是 HTML。这里把节点树摊成 run：
//   heading { level, segments }
//   paragraph { segments, quote?, indent?, prefix? }
//   code { lines }
//   rule
function inlineSegments(nodes, style, out) {
  for (const node of nodes || []) {
    switch (node.type) {
      case "text":
        pushSegment(out, node.value.replace(/\n/g, " "), style);
        break;
      case "code":
        pushSegment(out, node.value, { ...style, code: true });
        break;
      case "break":
        pushSegment(out, " ", style);
        break;
      case "image":
        pushSegment(out, node.alt, style);
        break;
      case "strong":
        inlineSegments(node.children, { ...style, bold: true }, out);
        break;
      case "em":
        inlineSegments(node.children, { ...style, italic: true }, out);
        break;
      case "del":
        inlineSegments(node.children, style, out);
        break;
      case "link":
        inlineSegments(node.children, { ...style, link: node.href }, out);
        break;
      default:
        break;
    }
  }
  return out;
}

function styleKey(style) {
  return `${style.bold ? 1 : 0}${style.italic ? 1 : 0}${style.code ? 1 : 0}|${style.link || ""}`;
}

function pushSegment(out, text, style) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && styleKey(last) === styleKey(style)) {
    last.text += text;
    return;
  }
  out.push({
    text,
    bold: Boolean(style.bold),
    italic: Boolean(style.italic),
    code: Boolean(style.code),
    link: style.link || null,
  });
}

function segmentsOf(nodes, style = EMPTY_STYLE) {
  return inlineSegments(nodes, style, []);
}

function tableSegments(cells) {
  const out = [];
  cells.forEach((cell, index) => {
    if (index) pushSegment(out, " ", EMPTY_STYLE);
    for (const segment of segmentsOf(cell)) pushSegment(out, segment.text, segment);
  });
  return out;
}

function runsOf(blocks, context, out) {
  for (const block of blocks || []) {
    switch (block.type) {
      case "heading":
        out.push({ type: "heading", level: block.level, segments: segmentsOf(block.children) });
        break;
      case "paragraph":
        out.push({
          type: "paragraph",
          segments: segmentsOf(block.children),
          quote: context.quote,
          indent: context.indent,
          prefix: context.prefix,
        });
        context.prefix = "";
        break;
      case "code":
        out.push({ type: "code", lines: block.text.split("\n") });
        break;
      case "thematicBreak":
        out.push({ type: "rule" });
        break;
      case "blockquote":
        runsOf(block.blocks, { ...context, quote: true, indent: context.indent + 24 }, out);
        break;
      case "table":
        out.push({
          type: "paragraph",
          segments: tableSegments(block.header),
          quote: context.quote,
          indent: context.indent,
        });
        for (const row of block.rows) {
          out.push({
            type: "paragraph",
            segments: tableSegments(row),
            quote: context.quote,
            indent: context.indent,
          });
        }
        break;
      case "list": {
        block.items.forEach((item, index) => {
          const prefix = block.ordered ? `${block.start + index}.` : "•";
          const itemContext = {
            quote: context.quote,
            indent: context.indent + 36,
            prefix,
          };
          runsOf(item.blocks, itemContext, out);
        });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

export function toRuns(markdown) {
  const runs = [];
  runsOf(parse(markdown), { quote: false, indent: 0, prefix: "" }, runs);
  return runs;
}
