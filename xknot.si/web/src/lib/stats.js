// L2 活动数据的页面侧归一化。
//
// 伙伴自报的只有窗口计数（docs/FEDERATION.md 第 5.5 节），这里只保留认识的字段，
// 其余一律丢掉：中枢不推断、不补零，也不把未知字段带进页面。缺数据时返回 null，
// 页面显示「未公开」而不是 0。

export const MAX_COUNT = 1_000_000_000;

export const STATS_FIELDS = {
  posts: ["total", "last24h", "last7d"],
  accounts: ["total", "last7d"],
  authors: ["active7d"],
};

function isoOrNull(value) {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

function count(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return Math.min(value, MAX_COUNT);
}

/**
 * @param {{ stats?: object, generatedAt?: string, fetchedAt?: string } | null} payload
 * @returns {{ posts?: object, accounts?: object, authors?: object, generatedAt: string|null, fetchedAt: string|null } | null}
 */
export function normalizeStats(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const source = payload.stats && typeof payload.stats === "object" ? payload.stats : payload;

  const out = {};
  let found = false;
  for (const [group, keys] of Object.entries(STATS_FIELDS)) {
    if (source[group] == null || typeof source[group] !== "object") continue;
    const cleaned = {};
    for (const key of keys) {
      const value = count(source[group][key]);
      if (value == null) continue;
      cleaned[key] = value;
      found = true;
    }
    if (Object.keys(cleaned).length) out[group] = cleaned;
  }

  if (!found) return null;
  return {
    ...out,
    generatedAt: isoOrNull(payload.generatedAt),
    fetchedAt: isoOrNull(payload.fetchedAt),
  };
}

/** 页面上的一行：优先最近 24 小时发帖，其次总量与活跃作者。 */
export function statsHighlights(stats) {
  if (!stats) return [];
  const out = [];
  if (Number.isInteger(stats.posts?.last24h)) out.push(["posts24h", stats.posts.last24h]);
  if (Number.isInteger(stats.posts?.total)) out.push(["posts", stats.posts.total]);
  if (Number.isInteger(stats.accounts?.total)) out.push(["accounts", stats.accounts.total]);
  if (!out.length && Number.isInteger(stats.authors?.active7d)) {
    out.push(["active7d", stats.authors.active7d]);
  }
  return out.slice(0, 2);
}
