// 给清单里已有、库里却没有申请单的实例补一张已通过的申请。
//
// 为什么会有这种实例：最早一批站点是先签发子域、后写进 instances.json 的，
// 那时没有走申请台，库里就没有对应的单。少了它，`admin-cli access <编号>`
// 找不到编号，只能每次手工拼接入件。
//
// 补记只做一件事：把清单里已经存在的事实抄成一条申请记录，并写明来源。
// 它不签发新东西，不改清单，不发信，也不假装当时有人审过。

import { labelFromUrl } from "../ops/subdomain.mjs";
import { subdomainUrl } from "./validate.mjs";

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
 * @param {string} [options.admin] 操作者，写进 reviewed_by
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

  const subdomain = labelFromUrl(entry.url);
  if (!subdomain) return { error: "not_hub_subdomain", instanceId: id };
  const url = subdomainUrl(subdomain);
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
    subdomain,
    url,
    operator,
    email: address,
    region,
    timezone,
    intro,
    tags,
    locale,
    // 补记的单子沿用清单里的签发日，不写成今天。
    reviewedAt: `${since}T00:00:00.000Z`,
    reviewedBy: admin || "backfill",
  });

  return { created: true, application: created };
}
