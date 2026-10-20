// 已通过的申请 → instances.json 的一条实例。
//
// 审核通过不等于自动上线：这里只生成一条能过校验的条目，
// 由人执行 admin-cli 写进清单，再重新构建门户。清单是版本库里的文件，
// 不让网页请求直接改它。

import { validateInstance } from "../ops/validate-instances.mjs";
import { subdomainUrl } from "./validate.mjs";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;

// 用站点域名当 id 的底子：伙伴换中文名时 id 也不会变成乱码。
// 新申请直接用子域标签当 id，这个函数只留给老数据与手工调用。
export function suggestId(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    host = "";
  }
  const label = host.split(".")[0] || "";
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  // 中文域名会被转成 xn--… 的 punycode，当 id 不好读，退回站点摘要。
  if (!slug.startsWith("xn--") && ID_RE.test(slug)) return slug;
  return `node-${host.replace(/[^a-z0-9]/g, "").slice(0, 12) || "partner"}`;
}

function localized(text) {
  return { en: text, "zh-CN": text, "zh-TW": text };
}

/**
 * @param {object} application 审核记录
 * @param {{ id?: string, since?: string, tier?: string }} options
 */
export function toManifestEntry(application, options = {}) {
  // 子域是身份：id 与 url 都从它来，不再看申请单上有没有别的地址。
  const subdomain = String(application.subdomain || "").trim();
  const url = subdomain ? subdomainUrl(subdomain) : String(application.url || "").replace(/\/$/, "");
  const since = options.since || new Date().toISOString().slice(0, 10);
  const tags = Array.isArray(application.tags) ? application.tags.slice(0, 5) : [];

  const entry = {
    id: options.id || (ID_RE.test(subdomain) ? subdomain : suggestId(url)),
    name: localized(application.name),
    shortName: localized(application.name.slice(0, 12)),
    logo: null,
    themeColor: "#0866FF",
    url,
    redirect: null,
    canonical: url,
    vertical: "creation",
    tags: tags.length ? localized(tags) : undefined,
    languages: ["en"],
    regions: [application.region],
    timezone: application.timezone,
    operator: localized(application.operator),
    owner: localized(application.operator),
    contact: application.email,
    social: [],
    termsUrl: null,
    privacyUrl: null,
    moderationUrl: null,
    intro: { oneLine: localized(application.intro) },
    since,
    tier: options.tier || "community",
    status: "active",
    // 审核通过只代表可以收录，不代表 /api/health 已接通。交接期先留空，
    // 公网探测通过后再由工作人员填回完整地址（见 docs/HANDOFF.md）。
    healthUrl: options.healthUrl || null,
    statsUrl: null,
    cardsUrl: null,
  };

  // undefined 字段不写进 JSON，保持清单干净。
  for (const key of Object.keys(entry)) if (entry[key] === undefined) delete entry[key];
  return entry;
}

// 生成后立刻用发布前的同一套规则自检，避免审核员手工补字段。
export function checkManifestEntry(entry, seen = new Set()) {
  return validateInstance(entry, seen);
}
