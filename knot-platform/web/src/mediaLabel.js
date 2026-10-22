// 用户发布的图片没有单独的替代文本字段，卡片里能拿到的是同一条记录的正文。
// 用正文前几十个字当 alt，比空 alt 强得多：读屏至少能知道这张图属于哪条内容。
// 只取纯文本，去掉 Markdown 标记与链接，避免把 `![图](url)` 或整条 URL 念出来。

const LIMIT = 80;

export function altLabel(text, limit = LIMIT) {
  const raw = String(text || "")
    // 图片语法整段丢掉：alt 里再念一遍图片名没有意义。
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    // 链接只留文字。
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_~>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  const chars = [...raw];
  if (chars.length <= limit) return raw;
  return `${chars.slice(0, Math.max(limit - 1, 1)).join("").trimEnd()}…`;
}

/**
 * 一张图的 alt。多图带上序号，读屏才知道还剩几张；没有正文时退回「图片」。
 * t 由调用方传入：这里不 import i18n，测试与 Node 侧都能直接用。
 */
export function photoAlt(t, label, index, total) {
  const base = String(label || "").trim();
  if (total < 2) return base || t("home.image");
  return base
    ? t("home.photoAlt", { label: base, n: index + 1, total })
    : t("home.photoAltPlain", { n: index + 1, total });
}
