// L3 热点橱窗的净化。
//
// 伙伴把橱窗写在自己的站点（docs/FEDERATION.md 第 6 节），中枢取回后只保留
// 门户能安全渲染的部分：标题、摘要、https 链接与生成时间。正文不进页面，点开回原站。
// 字段上限与联邦文档一致；超长截断，不合规的整条丢掉，不做猜测性修补。

export const CARD_LIMIT = 3;
export const TITLE_MAX = 80;
export const SUMMARY_MAX = 160;
export const ID_MAX = 64;
export const LANG_MAX = 16;

const DAY = 86_400_000;

// 7 天内是“热”，超过 7 天转灰，超过 30 天整组不再展示。
export const FRESH_MS = DAY;
export const AGING_MS = 7 * DAY;
export const STALE_MS = 30 * DAY;

function clip(value, max) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

function httpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isoOrNull(value) {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/**
 * 把 var/cards/{id}.json 收成页面可用的卡片列表。
 * 缺 title 或 url 的条目直接跳过；顺序保留伙伴自己的编排。
 * @param {{ cards?: unknown[], generatedAt?: string } | null} payload
 * @param {{ max?: number }} [options]
 */
export function normalizeCards(payload, { max = CARD_LIMIT } = {}) {
  const list = Array.isArray(payload?.cards) ? payload.cards : [];
  const updatedAt = isoOrNull(payload?.generatedAt);
  const out = [];

  for (const card of list) {
    if (out.length >= max) break;
    const title = clip(card?.title, TITLE_MAX);
    const url = httpsUrl(card?.url);
    if (!title || !url) continue;
    out.push({
      id: clip(card?.id, ID_MAX) || `card-${out.length + 1}`,
      title,
      url,
      summary: clip(card?.summary, SUMMARY_MAX),
      lang: clip(card?.lang, LANG_MAX),
      updatedAt,
    });
  }

  return out;
}

/** fresh（今天）→ recent（一周内）→ aging（一月内，转灰）→ stale（不再展示）。 */
export function cardState(updatedAt, now = Date.now()) {
  const at = typeof updatedAt === "string" ? Date.parse(updatedAt) : NaN;
  if (Number.isNaN(at)) return "unknown";
  const current = now instanceof Date ? now.getTime() : Number(now);
  const age = Math.max(0, current - at);
  if (age < FRESH_MS) return "fresh";
  if (age < AGING_MS) return "recent";
  if (age < STALE_MS) return "aging";
  return "stale";
}

/** 页面展示的卡片：第一个还没过期的。 */
export function hotCard(cards, now = Date.now()) {
  if (!Array.isArray(cards)) return null;
  return cards.find((card) => cardState(card.updatedAt, now) !== "stale") || null;
}
