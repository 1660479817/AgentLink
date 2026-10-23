// 中枢登记表、取回的站点档案与探测结果合成门户读取的运行时快照。
//
// 这个格式是取回任务和门户之间的契约，两边共用这一份实现：
// ops/build-hub-data.mjs 在发布时写文件，web 的开发服务器现算同一份。
//
// 一条门户条目由两部分拼成：
//   * 签发区 —— instances.json 里的 id、url、since、tier、status；
//   * 自述区 —— var/profiles/{id}.json 里的 name、tagline、region 等，
//     由实例通过 GET /api/federation/profile 自报，中枢只缓存、不改写。

import { normalizeCards } from "./cards.js";
import { normalizeStats } from "./stats.js";

// 站点自报的 logo 必须是绝对 https 地址；旧的中枢本地 public/ 相对路径不再接受。
// 页面上无论在多深的路径都要能取到绝对地址，所以统一按 URL 处理。
export function normalizeAsset(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  if (/^https:\/\//i.test(trimmed)) return trimmed;
  return null;
}

// 站点地址直接进 href。只在构建期由 validate-instances 校验过一次是不够的：
// 直接 npm run build、或开发服务器读到坏清单时都不过那道闸。这里按协议放行 https。
export function normalizeUrl(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const trimmed = value.trim();
  try {
    // 用 URL 只做协议判定，不取 url.href：后者会把 https://a.test 补成带尾斜杠的形式，
    // 快照里的原样地址不该因为过了一道校验就被改写。
    return new URL(trimmed).protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

// 零宽与双向控制符不可见，却能把真实后缀藏起来或让名字读成另一个站。
// 名称是卡片上唯一的可见文字，在联邦目录里这等同于身份混淆。
const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export function stripInvisible(value) {
  if (typeof value !== "string") return null;
  return value.replace(INVISIBLE, "").trim();
}

function cleanTextList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((tag) => stripInvisible(tag)).filter((tag) => tag);
}

/**
 * @param {{ instances?: unknown[] }} manifest 中枢登记表（只有签发区）
 * @param {{ instances?: Record<string, unknown> }} health
 * @param {Date} [now]
 * @param {Record<string, unknown>} [cards] var/cards/ 里的橱窗，按实例 id 索引
 * @param {Record<string, unknown>} [stats] var/stats/ 里的活动数据，按实例 id 索引
 * @param {Record<string, unknown>} [profiles] var/profiles/ 里的站点档案，按实例 id 索引
 */
export function buildHubData(manifest, health, now = new Date(), cards = {}, stats = {}, profiles = {}) {
  const states = health?.instances || {};
  const instances = Array.isArray(manifest?.instances) ? manifest.instances : [];

  return {
    generatedAt: now.toISOString(),
    // 探测时间才是“同步”的时刻；生成时间是每次请求都变，不能当新鲜度。
    checkedAt: health?.checkedAt ?? null,
    // pending 是已收录、未通过 /api/health 验收：留在登记表里等验收，但不上门户。
    instances: instances
      .filter((instance) => instance?.status !== "pending")
      .map((instance) => {
        const state = states[instance?.id] || null;
        const cached = profiles?.[instance.id] || null;
        const site = cached?.site || {};
        return {
          id: instance.id,
          // 还在自述的条目也要能显示：名称缺了就退回 id，介绍缺了就是空。
          // 名称、介绍、标签都去掉不可见字符：hub.json 也可能由旧构建写出，
          // 页面不能因为「快照已经清洗过」就省掉这一步。
          name: stripInvisible(site.name) || instance.id,
          tagline: stripInvisible(site.tagline),
          intro: stripInvisible(site.intro),
          logo: normalizeAsset(site.logo),
          owner: stripInvisible(site.owner),
          contact: stripInvisible(site.contact),
          region: site.region ?? null,
          // 只把主理人写下的钟带出去；没写就是 null，页面按出口 IP 推一个。
          timezone: site.timezone || null,
          tags: cleanTextList(site.tags),
          url: normalizeUrl(instance.url),
          // 自述区最近一次取回的时刻。null 表示还没收到过这个站点的档案。
          profileFetchedAt: cached?.fetchedAt ?? null,
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
                // 连续断连满 7 天（或收录后 30 天仍未接通）时，条目暂时不展示。
                // 登记表本身不动，这是渲染时的一次判断。
                downSince: state.downSince ?? null,
                hidden: Boolean(state.hiddenAt),
              }
            : null,
        };
      }),
  };
}
