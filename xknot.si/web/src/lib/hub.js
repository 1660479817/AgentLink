// 运行时快照到页面视图的转换。
//
// 输入是 build-hub-data.mjs 写出的 hub.json，输出是页面直接可渲染的条目。
// 这里只做纯计算：不回退到默认语种之外的翻译，不排序之外的猜测。

import { groupsOf, REGION_GROUPS } from "./regions.js";
import { normalizeAsset, stripInvisible } from "./snapshot.js";
import { timezoneOf } from "./timezones.js";

// 清单里的档位：示例 > 收费 > 免费。partner / community 是旧词，读到也按新档位排。
const TIER_ORDER = { demo: 0, paid: 1, partner: 1, free: 2, community: 2 };

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
 * @param {{ locations?: unknown }} options 中枢观测到的位置，见 GET /api/locations
 */
export function buildView(data, options = {}) {
  const list = Array.isArray(data?.instances) ? data.instances : [];
  const locations = options.locations || null;

  // 连续不可达满 7 天、或签发后 30 天仍未接通，条目暂时不出现在门户。
  // 判断依据是探测写下的 hiddenAt，不是清单里的 status。
  return sortInstances(list)
    .filter((instance) => instance?.health?.hidden !== true)
    .map((instance) => {
      const health = instance.health || null;
      // 位置以观测到的出口 IP 为准：机器会搬，自述区的 region 是入网那天写的。
      // 没有观测值（隧道没起来、或中枢不是入口主机）才回落到自述区。
      const located = observedLocation(locations, instance.id);
      const region = located?.country || (typeof instance.region === "string" ? instance.region : null);

      // 钟：主理人写了就按他写的走，没写才用出口 IP 的国家推一个。
      // 推出来的钟带标记，页面上说清楚「这个不是主理人写的」。
      const declared = typeof instance.timezone === "string" && instance.timezone.trim();
      const inferred = declared ? null : timezoneOf(located?.country);
      const timezone = declared || inferred || "UTC";

      return {
        id: instance.id,
        // 自述区已经是扁平字符串，门户不再按语种取一次：填什么就显示什么。
        // 不可见字符在这里再去一次：旧快照或测试夹具不一定清洗过。
        name: stripInvisible(instance.name) || instance.id,
        tagline: instance.tagline || "",
        intro: instance.intro || "",
        // 徽记进 img src：只认绝对 https，旧快照里的相对路径或数据协议一律不用。
        logo: normalizeAsset(instance.logo),
        owner: instance.owner || "",
        contact: instance.contact || "",
        tags: Array.isArray(instance.tags)
          ? instance.tags.map((tag) => stripInvisible(tag)).filter((tag) => typeof tag === "string" && tag)
          : [],
        // 地址进 href，只放行 https；不合格就不给链接，卡片上仍显示名称。
        url: typeof instance.url === "string" && /^https:\/\//i.test(instance.url) ? instance.url : null,
        tier: instance.tier,
        // 清单里的四态：pending 不进快照，剩下的 active / suspended / retired
        // 要一路带到卡片与地图上，否则暂停的实例会带着最后一次「在线」留在目录里。
        status: typeof instance.status === "string" ? instance.status : "active",
        timezone,
        // 钟不是自述区写的：卡片上标一下，免得主理人以为谁改了他的档案。
        timezoneInferred: Boolean(inferred),
        region,
        // 位置来自出口 IP 时带上来源与时间：页面据此说明「这个区域不是注册时填的」。
        located,
        groups: groupsOf(region ? [region] : []),
        cards: Array.isArray(instance.cards) ? instance.cards : [],
        health: {
          status: health?.status || "unknown",
          lastOkAt: health?.lastOkAt || null,
          latencyMs: typeof health?.latencyMs === "number" ? health.latencyMs : null,
          checkedAt: health?.checkedAt || null,
          version: health?.version || null,
        },
        // 页面显示的状态：清单的 suspended / retired 压过健康结果。
        // 这两态不再探测，health 停在最后一次 up，照搬就会把暂停的站画成在线。
        state: (typeof instance.status === "string" && instance.status !== "active"
          ? instance.status
          : health?.status) || "unknown",
      };
    });
}

/**
 * 用运行时探测结果覆盖快照里的健康字段。
 *
 * `hub.json` 是构建那一刻的采样，重新构建才会更新；探测每 15 分钟一轮。
 * 只换探测这一层，签发区、自述区、橱窗与活动数据仍以快照为准：
 * 快照里没有的 id 不新增条目（清单只有构建机知道），探测里没有的 id 保留快照值。
 *
 * @param {{ instances?: unknown[] }} data hub.json
 * @param {{ checkedAt?: string, probes?: unknown } | null} probes 见 GET /api/probes
 */
export function applyProbes(data, probes) {
  const table = probes?.probes && typeof probes.probes === "object" ? probes.probes : probes;
  if (!table || typeof table !== "object" || Array.isArray(table)) return data;
  if (!Object.keys(table).length) return data;
  const checkedAt = typeof probes?.checkedAt === "string" ? probes.checkedAt : null;
  const list = Array.isArray(data?.instances) ? data.instances : [];

  return {
    ...data,
    // 最近同步是探测时间，不是构建时间：换了状态就该跟着换。
    checkedAt: checkedAt || data?.checkedAt || null,
    instances: list.map((instance) => {
      const probe = table[instance?.id];
      if (!probe || typeof probe !== "object") return instance;
      return {
        ...instance,
        health: {
          status: typeof probe.status === "string" ? probe.status : "unknown",
          latencyMs: Number.isFinite(probe.latencyMs) ? probe.latencyMs : null,
          version: typeof probe.version === "string" ? probe.version : null,
          lastOkAt: probe.lastOkAt || null,
          // 断连满 7 天 / 收录后 30 天仍未接通，隐藏也是探测写下的，跟着一起更新。
          hidden: probe.hidden === true,
          downSince: probe.downSince || null,
          checkedAt: checkedAt || instance?.health?.checkedAt || null,
        },
      };
    }),
  };
}

// 中枢按隧道对端 IP 判定的国家码。locations 既接受 /api/locations 的整包，
// 也接受 { id: { country } } 这一层，省得调用方先拆一遍。
function observedLocation(locations, id) {
  const table = locations?.locations && typeof locations.locations === "object" ? locations.locations : locations;
  const hit = table?.[id];
  const country = typeof hit?.country === "string" ? hit.country.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(country)) return null;
  return { country, at: hit.at || null, source: "tunnel" };
}

// 页面上出现的筛选项：全部 + 实际用到的分组，顺序固定。
export function availableGroups(view) {
  const used = new Set();
  for (const item of view) for (const group of item.groups) used.add(group);
  return REGION_GROUPS.filter((group) => used.has(group));
}

// 顶栏和英雄区用的概览数字。
// healthy 只算 up；reachable 把 degraded 也算上；未探测两者都不算。
// 暂停与退役的实例不探测，健康状态停在最后一次记录上，因此必须先看清单状态：
// 否则一个 suspended 的站会带着 last up 一直计进「在线」。
export function isActive(item) {
  return !item?.status || item.status === "active";
}

export function isReachable(item) {
  if (!isActive(item)) return false;
  const status = item?.health?.status;
  return status === "up" || status === "degraded";
}

export function summarize(view, generatedAt = null) {
  return {
    nodes: view.length,
    regions: availableGroups(view).length,
    healthy: view.filter((item) => isActive(item) && item.health.status === "up").length,
    reachable: view.filter(isReachable).length,
    generatedAt: generatedAt || null,
  };
}

// 入口是 root 这类只跳转的条目，也在列表里显示，只是不计入实例统计。
export function filterByGroup(view, group) {
  if (!group || group === "all") return view;
  return view.filter((item) => item.groups.includes(group));
}

// 页面上出现的标签：全部 + 实际用到的，按首次出现排序，不做词频统计。
export function availableTags(view) {
  const seen = new Set();
  for (const item of view) for (const tag of item.tags) seen.add(tag);
  return [...seen];
}

// 自由文本标签：原样比较，只看是否包含。没有标签的条目在任何标签下都不出现。
export function filterByTag(view, tag) {
  if (!tag) return view;
  return view.filter((item) => item.tags.includes(tag));
}
