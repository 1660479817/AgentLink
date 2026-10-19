import { parse } from "./parse.js";

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attribute(value) {
  return escapeHtml(value);
}

function inlineHtml(nodes, options) {
  let out = "";
  for (const node of nodes || []) {
    switch (node.type) {
      case "text":
        out += escapeHtml(node.value);
        break;
      case "code":
        out += `<code>${escapeHtml(node.value)}</code>`;
        break;
      case "break":
        out += "<br>";
        break;
      case "strong":
        out += `<strong>${inlineHtml(node.children, options)}</strong>`;
        break;
      case "em":
        out += `<em>${inlineHtml(node.children, options)}</em>`;
        break;
      case "del":
        out += `<del>${inlineHtml(node.children, options)}</del>`;
        break;
      case "link":
        if (options.links) {
          out += `<a href="${attribute(node.href)}" rel="noopener noreferrer" target="_blank">${inlineHtml(node.children, options)}</a>`;
        } else {
          out += inlineHtml(node.children, options);
        }
        break;
      case "image":
        if (options.images) {
          out += `<img src="${attribute(node.src)}" alt="${attribute(node.alt)}" loading="lazy" decoding="async">`;
        } else {
          out += escapeHtml(node.alt);
        }
        break;
      default:
        break;
    }
  }
  return out;
}

function tableHtml(block, options) {
  const alignClass = (align) => (options.alignClasses && align ? ` class="${options.alignPrefix}${align}"` : "");
  const cell = (tag, nodes, align) => `<${tag}${alignClass(align)}>${inlineHtml(nodes, options)}</${tag}>`;
  const head = block.header.map((nodes, index) => cell("th", nodes, block.aligns[index])).join("");
  const body = block.rows
    .map(
      (row) =>
        `<tr>${block.header
          .map((_, index) => cell("td", row[index] || [], block.aligns[index]))
          .join("")}</tr>`
    )
    .join("");
  const table = `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  return options.tableClass ? `<div class="${attribute(options.tableClass)}">${table}</div>` : table;
}

function listItemHtml(item, tight, options) {
  const parts = item.blocks.map((block, index) => {
    if (tight && index === 0 && block.type === "paragraph") return inlineHtml(block.children, options);
    return blockHtml(block, options);
  });
  const content = parts.join("");
  const box =
    item.task === null || item.task === undefined
      ? ""
      : `<input type="checkbox" disabled${item.task ? " checked" : ""} aria-hidden="true"> `;
  const cls = item.task === null || item.task === undefined ? "" : ' class="md-task"';
  return `<li${cls}>${box}${content}</li>`;
}

function blockHtml(block, options) {
  switch (block.type) {
    case "heading": {
      const level = Math.max(1, Math.min(options.maxHeading, block.level));
      return `<h${level}>${inlineHtml(block.children, options)}</h${level}>`;
    }
    case "paragraph":
      return `<p>${inlineHtml(block.children, options)}</p>`;
    case "code": {
      const lang = block.language ? ` class="language-${attribute(block.language)}"` : "";
      return `<pre><code${lang}>${escapeHtml(block.text)}</code></pre>`;
    }
    case "blockquote":
      return `<blockquote>${blocksHtml(block.blocks, options)}</blockquote>`;
    case "thematicBreak":
      return "<hr>";
    case "table":
      return tableHtml(block, options);
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      const attrs = [
        block.ordered && block.start !== 1 ? ` start="${block.start}"` : "",
        block.items.some((item) => item.task !== null && item.task !== undefined) ? ' class="md-tasks"' : "",
      ].join("");
      const items = block.items.map((item) => listItemHtml(item, block.tight, options)).join("");
      return `<${tag}${attrs}>${items}</${tag}>`;
    }
    default:
      return "";
  }
}

function blocksHtml(blocks, options) {
  return (blocks || []).map((block) => blockHtml(block, options)).join("");
}

const DEFAULT_OPTIONS = {
  maxHeading: 6,
  tableClass: "md-table",
  alignClasses: true,
  alignPrefix: "md-",
  links: true,
  images: true,
};

export function toHtml(input, options = {}) {
  const blocks = typeof input === "string" ? parse(input) : input;
  return blocksHtml(blocks, { ...DEFAULT_OPTIONS, ...options });
}
