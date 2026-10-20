// 运行时快照到页面视图的转换。
//
// 输入是 build-hub-data.mjs 写出的 hub.json，输出是页面直接可渲染的条目。
// 这里只做纯计算：不回退到默认语种之外的翻译，不排序之外的猜测。

import { pickLocalized } from "./i18n.js";
import { groupsOf, REGION_GROUPS } from "./regions.js";

const TIER_ORDER = { demo: 0, partner: 1, community: 2 };

function tierRank(tier) {
  return TIER_ORDER[tier] ?? 99;
}

// 页面按分级、再按收录日期排。日期相同按 id，保证顺序稳定。
export function sortInstances(list) {
  return [...list].sort((a, b) => {
    const byTier = tierRank(a.tier) - tierRank(b.tier);
    if (byTier !== 0) return byTier;
    const bySince = String(a.since || "").localeCompare(String(b.since || ""));
    if (bySince !== 0) return bySince;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * @param {{ instances?: unknown[] }} data hub.json
 * @param {{ locale: string }} options
 */
export function buildView(data, { locale }) {
  const list = Array.isArray(data?.instances) ? data.instances : [];

  // 连续不可达满 7 天、或签发后 30 天仍未接通，条目暂时不出现在门户。
  // 判断依据是探测写下的 hiddenAt，不是清单里的 status。
  return sortInstances(list)
    .filter((instance) => instance?.health?.hidden !== true)
    .map((instance) => {
      const health = instance.health || null;
      return {
        id: instance.id,
        name: pickLocalized(instance.name, locale) || instance.id,
        shortName: pickLocalized(instance.shortName, locale),
        intro: pickLocalized(instance.intro?.oneLine, locale),
        tags: pickLocalized(instance.tags, locale) || [],
        logo: instance.logo,
        themeColor: instance.themeColor,
        url: instance.url,
        tier: instance.tier,
        status: instance.status,
        timezone: instance.timezone || "UTC",
        regions: Array.isArray(instance.regions) ? instance.regions : [],
        groups: groupsOf(instance.regions),
        cards: Array.isArray(instance.cards) ? instance.cards : [],
        health: {
          status: health?.status || "unknown",
          lastOkAt: health?.lastOkAt || null,
          latencyMs: typeof health?.latencyMs === "number" ? health.latencyMs : null,
          checkedAt: health?.checkedAt || null,
          version: health?.version || null,
        },
      };
    });
}

// 页面上出现的筛选项：全部 + 实际用到的分组，顺序固定。
export function availableGroups(view) {
  const used = new Set();
  for (const item of view) for (const group of item.groups) used.add(group);
  return REGION_GROUPS.filter((group) => used.has(group));
}

// 顶栏和英雄区用的概览数字。
// healthy 只算 up；reachable 把 degraded 也算上；未探测两者都不算。
export function summarize(view, generatedAt = null) {
  return {
    nodes: view.length,
    regions: availableGroups(view).length,
    healthy: view.filter((item) => item.health.status === "up").length,
    reachable: view.filter(
      (item) => item.health.status === "up" || item.health.status === "degraded"
    ).length,
    generatedAt: generatedAt || null,
  };
}

// 入口是 root 这类只跳转的条目，也在列表里显示，只是不计入实例统计。
export function filterByGroup(view, group) {
  if (!group || group === "all") return view;
  return view.filter((item) => item.groups.includes(group));
}
