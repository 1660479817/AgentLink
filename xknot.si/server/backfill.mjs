// 给清单里已有、库里却没有申请单的实例补一张已通过的申请。
//
// 为什么会有这种实例：最早一批站点是先签发子域、后写进 instances.json 的，
// 那时没有走申请台，库里就没有对应的单。少了它，`admin-cli access <编号>`
// 找不到编号，只能每次手工拼接入件。
//
// 补记只做一件事：把清单里已经存在的事实抄成一条申请记录，并写明来源。
// 它不签发新东西，不改清单，不发信，也不假装当时有人审过。

import { subdomainUrl } from "./validate.mjs";

const SUBDOMAIN_SUFFIX = ".xknot.si";

/** 从清单条目推出接入模式。子域是本中枢签发的，其余都是自有域名。 */
export function modeOf(entry) {
  let host = "";
  try {
    host = new URL(String(entry?.url || "")).hostname.toLowerCase();
  } catch {
    return { mode: "own-domain", subdomain: null };
  }
  if (!host.endsWith(SUBDOMAIN_SUFFIX)) return { mode: "own-domain", subdomain: null };
  const label = host.slice(0, -SUBDOMAIN_SUFFIX.length);
  // 只认一级标签：a.b.xknot.si 不是中枢签发的形态。
  return label && !label.includes(".") ? { mode: "subdomain", subdomain: label } : { mode: "own-domain", subdomain: null };
}

/** 自述区字段都是扁平字符串，只做去空白。 */
function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {object} options
 * @param {object} options.store    openStore() 的实例
 * @param {object} options.manifest instances.json 的内容
 * @param {string} options.instanceId 清单里的 id
 * @param {object} [options.profile] var/profiles/<id>.json 的内容，用来填名称与联系方式
 * @param {string} options.email   申请单上的联系邮箱（必填：没有邮箱的单不成立）
 * @param {string} [options.admin] 操作者，写进 review_note
 * @param {Date}   [options.now]
 */
export function backfillApplication({ store, manifest, instanceId, profile = null, email, admin = "", now = new Date() }) {
  const id = String(instanceId || "").trim();
  const entry = (manifest?.instances || []).find((item) => item.id === id);
  if (!entry) return { error: "no_instance", instanceId: id };

  // 已经有一张单（任何状态）就什么都不做：重复执行不该多出记录。
  const existing = store.findByUrl(entry.url);
  if (existing) return { skipped: "exists", application: existing };

  const address = String(email || "").trim();
  if (!address) return { error: "no_email", instanceId: id };

  const { mode, subdomain } = modeOf(entry);
  const url = mode === "subdomain" ? subdomainUrl(subdomain) : String(entry.url).replace(/\/+$/, "");
  const body = profile?.site || {};
  const name = text(body.name) || id;
  const operator = text(body.owner) || name;
  const intro = text(body.tagline);
  const region = text(body.region) || "GLOBAL";
  const timezone = text(body.timezone) || "UTC";
  const locale = null;
  const tags = Array.isArray(body.tags) ? body.tags.map(String).slice(0, 9) : [];

  const today = now.toISOString().slice(0, 10);
  const since = String(entry.since || today).slice(0, 10);

  const created = store.createApplication({
    name,
    mode,
    subdomain: subdomain || "",
    domain: mode === "own-domain" ? url : "",
    url,
    operator,
    email: address,
    region,
    timezone,
    intro,
    tags,
    locale,
  });

  // 走和正常审核同一条状态机：pending → verified → approved。
  store.transition({
    id: created.id,
    to: "verified",
    patch: { verifiedAt: `${since}T00:00:00.000Z` },
    eventKind: "application.verified",
  });
  const reviewed = store.transition({
    id: created.id,
    to: "approved",
    admin: admin || null,
    patch: {
      reviewedAt: `${since}T00:00:00.000Z`,
      reviewedBy: admin || null,
      reviewNote: `按 instances.json 补记：${id} 在 ${since} 已是 ${entry.status || "active"}，原申请单缺失。地址与签发日取自清单，其余取自站点自述区。`,
    },
  });

  return { created: true, application: reviewed.application };
}
