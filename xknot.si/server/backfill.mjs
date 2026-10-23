// 给清单里已有、库里却没有申请单的实例补一张已通过的申请。
//
// 为什么会有这种实例：最早一批站点是先签发子域、后写进 instances.json 的，
// 那时没有走申请台，库里就没有对应的单。少了它，`admin-cli access <编号>`
// 找不到编号，只能每次手工拼接入件。
//
// 补记只做一件事：把清单里已经存在的事实抄成一条申请记录，并写明来源。
// 它不签发新东西，不改清单，不发信，也不假装当时有人审过。

import { labelFromUrl } from "../ops/subdomain.mjs";
import {
  LIMITS,
  cleanField,
  normalizeTags,
  subdomainUrl,
  validEmail,
  validRegion,
  validTimeZone,
} from "./validate.mjs";

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
// 补记是「把已有事实抄下来」，超长就截断到上限，不因为自述区写了一篇简介
// 就整张单失败；cleanField 按申请表的口径返回 max+1 个字符用于判超限，
// 落库这里再收一次。
function clamp(value, max) {
  return [...cleanField(value, max)].slice(0, max).join("");
}

export function backfillApplication({
  store,
  manifest,
  instanceId,
  profile = null,
  email,
  region = "",
  admin = "",
  now = new Date(),
}) {
  const id = String(instanceId || "").trim();
  const entry = (manifest?.instances || []).find((item) => item.id === id);
  if (!entry) return { error: "no_instance", instanceId: id };

  // 已经有一张单（任何状态）就什么都不做：重复执行不该多出记录。
  const existing = store.findByUrl(entry.url);
  if (existing) return { skipped: "exists", application: existing };

  // 自述区是外部输入（伙伴站点自己写的），落库前过与申请表同一套清洗：
  // 邮箱要合格式，名称/联系方/简介有上限，标签有长度。
  const address = validEmail(email);
  if (!address) return { error: "bad_email", instanceId: id };

  const subdomain = labelFromUrl(entry.url);
  if (!subdomain) return { error: "not_hub_subdomain", instanceId: id };
  const url = subdomainUrl(subdomain);
  const body = profile?.site || {};
  const name = clamp(body.name, LIMITS.name) || id;
  const operator = clamp(body.owner, LIMITS.operator) || name;
  const intro = clamp(body.tagline, LIMITS.intro);

  // 区域只认真实国家码。以前缺省写 "GLOBAL"：那不是国家码，门户按它排版
  // 会落到一张错的地图上，而"不知道在哪"和"全球"是两件事。
  const located = validRegion(region) || validRegion(body.region);
  if (!located) return { error: "no_region", instanceId: id };
  const timezone = validTimeZone(body.timezone) ? body.timezone.trim() : "UTC";
  const locale = null;
  const tags = normalizeTags(body.tags)
    .filter((tag) => [...tag].length <= LIMITS.tagLength)
    .slice(0, LIMITS.tags);

  const today = now.toISOString().slice(0, 10);
  const since = String(entry.since || today).slice(0, 10);

  const created = store.createApplication({
    name,
    subdomain,
    url,
    operator,
    email: address,
    region: located,
    timezone,
    intro,
    tags,
    locale,
    // 补记的单子沿用清单里的签发日，不写成今天。
    reviewedAt: `${since}T00:00:00.000Z`,
    reviewedBy: admin || "backfill",
  });

  // 唯一索引可能挡住它（另一个进程刚补了同一个子域），那不是内部错误。
  if (created?.error) return { error: created.error, instanceId: id };

  return { created: true, application: created };
}
