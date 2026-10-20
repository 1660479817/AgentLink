// 实例清单与探测结果合成门户读取的运行时快照。
//
// 这个格式是探测任务和门户之间的契约，两边共用这一份实现：
// ops/build-hub-data.mjs 在发布时写文件，web 的开发服务器现算同一份。

import { normalizeCards } from "./cards.js";
import { normalizeStats } from "./stats.js";

// 清单里的 logo 相对 public/ 写，例如 logos/travel.svg；
// 页面上无论在多深的路径都要能取到，统一补成根路径。
export function normalizeAsset(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `/${trimmed.replace(/^\/+/, "")}`;
}

/**
 * @param {{ instances?: unknown[] }} manifest
 * @param {{ instances?: Record<string, unknown> }} health
 * @param {Date} [now]
 * @param {Record<string, unknown>} [cards] var/cards/ 里的橱窗，按实例 id 索引
 * @param {Record<string, unknown>} [stats] var/stats/ 里的活动数据，按实例 id 索引
 */
export function buildHubData(manifest, health, now = new Date(), cards = {}, stats = {}) {
  const states = health?.instances || {};
  const instances = Array.isArray(manifest?.instances) ? manifest.instances : [];

  return {
    generatedAt: now.toISOString(),
    // 探测时间才是“同步”的时刻；生成时间是每次请求都变，不能当新鲜度。
    checkedAt: health?.checkedAt ?? null,
    instances: instances.map((instance) => {
      const state = states[instance?.id] || null;
      return {
        id: instance.id,
        name: instance.name,
        shortName: instance.shortName ?? null,
        logo: normalizeAsset(instance.logo),
        themeColor: instance.themeColor ?? null,
        url: instance.url,
        redirect: instance.redirect ?? null,
        canonical: instance.canonical ?? null,
        vertical: instance.vertical ?? null,
        tags: instance.tags ?? null,
        languages: instance.languages ?? [],
        regions: instance.regions ?? [],
        timezone: instance.timezone ?? "UTC",
        operator: instance.operator ?? null,
        owner: instance.owner ?? null,
        intro: instance.intro ?? null,
        since: instance.since ?? null,
        tier: instance.tier,
        status: instance.status,
        // L3 橱窗只带摘要与跳转地址；正文不进门户。
        cards: normalizeCards(cards?.[instance.id]),
        // L2 活动数据是伙伴自报的计数，缺数据时为 null，页面显示「未公开」。
        stats: normalizeStats(stats?.[instance.id]),
        health: state
          ? {
              status: state.status,
              lastOkAt: state.lastOkAt ?? null,
              latencyMs: state.latencyMs ?? null,
              version: state.version ?? null,
              checkedAt: health?.checkedAt ?? null,
            }
          : null,
      };
    }),
  };
}
