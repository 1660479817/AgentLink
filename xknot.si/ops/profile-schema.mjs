// 站点档案（L1）的字段契约。
//
// L1 现在装在两处：
//   * 签发区 issued —— 中枢决定：id、url、since、tier、status。写在 xknot.si/instances.json。
//   * 自述区 site —— 主理人决定：名称、介绍、联系方式等。写在实例自己的 profile.json，
//     由中枢按 url 取回，副本落 var/profiles/{id}.json。
//
// 这个模块是自述区唯一的校验实现。中枢取回时校验，门户构建时也按它清洗；
// 实例侧有一份自己的最小校验（knot-platform/backend/src/profile.js），
// 两边规则以本文件为准，见 docs/FEDERATION.md 第 4 节。
//
// v2 起自述区是十项扁平字段，没有多语种文案映射：主理人填什么，门户就显示什么。
// 唯一的语种字段是 `locale`：站点默认的界面语言，实例自己用，门户只做校验。

import { HUB_SUFFIX, labelFromUrl } from "./subdomain.mjs";

export const FORMAT_VERSION = 2;

// 与 knot-platform/packages/knot-locale 的三项保持一致。两个项目各自独立，
// 这条白名单很小，重复一份比跨项目引包清楚。
export const LOCALES = ["zh-CN", "zh-TW", "en"];

export const LIMITS = {
  name: 40,
  tagline: 60,
  intro: 800,
  logo: 300,
  owner: 40,
  contact: 120,
  region: 2,
  timezone: 40,
  tag: 16,
  tags: 9,
};

export const TIERS = ["demo", "free", "paid"];
export const STATUSES = ["pending", "active", "suspended", "retired"];

const ISSUED_FIELDS = ["id", "url", "since", "tier", "status", "cardsUrl", "statsUrl"];
export const SITE_FIELDS = [
  "name",
  "locale",
  "tagline",
  "intro",
  "logo",
  "owner",
  "contact",
  "region",
  "timezone",
  "tags",
];

// 落盘文件名与清单 id 共用这一条：id 会拼进 var/*/{id}.json，带 / 或 .. 就写到目录外。
export const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REGION_RE = /^[A-Z]{2}$/;

export function isHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.host);
  } catch {
    return false;
  }
}

function validTimeZone(value) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function lengthOf(text) {
  return [...text].length;
}

function cleanText(value, max) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim();
  if (!text) return null;
  return lengthOf(text) > max ? [...text].slice(0, max).join("").trimEnd() : text;
}

function cleanUrl(value, field, problems) {
  if (value == null || value === "") return null;
  if (!isHttpsUrl(value)) {
    problems.push(`${field}: must be https, or omit it`);
    return null;
  }
  if (lengthOf(String(value)) > LIMITS.logo) {
    problems.push(`${field}: longer than ${LIMITS.logo}`);
    return null;
  }
  return String(value).trim();
}

function cleanRegion(value, problems) {
  if (value == null || value === "") return null;
  const code = String(value).trim().toUpperCase();
  if (code === "GLOBAL") return code;
  // 中枢按区域分组渲染：认不出的码归入「其他」，这里只拦形状。
  if (!REGION_RE.test(code)) {
    problems.push("region: must be a two-letter country code, or GLOBAL");
    return null;
  }
  return code;
}

// 自由文本标签：忽略大小写去重，顺序保持主理人排的那个。
function cleanTags(value, problems) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    problems.push("tags: must be an array of strings");
    return null;
  }
  const out = [];
  const seen = new Set();
  for (const raw of value) {
    const tag = cleanText(raw, LIMITS.tag);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  if (out.length > LIMITS.tags) {
    problems.push(`tags: more than ${LIMITS.tags}`);
    return null;
  }
  return out.length ? out : null;
}

/**
 * 清洗一份自述区。返回可以直接落盘的 site，以及发现的问题。
 * 有问题的字段会被丢掉；没有名字时才不给出 site（门户没有可显示的名称）。
 * @param {unknown} input
 * @returns {{ ok: boolean, problems: string[], site: object | null }}
 */
export function cleanSite(input) {
  const problems = [];
  if (input == null) return { ok: true, problems, site: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, problems: ["site: must be a JSON object"], site: null };
  }

  for (const key of Object.keys(input)) {
    if (!SITE_FIELDS.includes(key)) problems.push(`${key}: unknown field, remove it`);
  }

  const site = {};

  const name = cleanText(input.name, LIMITS.name);
  if (name) site.name = name;

  // 站点默认的界面语言。实例自己用它决定首访语种；这里只拦取值。
  if (input.locale != null && input.locale !== "") {
    const locale = String(input.locale).trim();
    if (LOCALES.includes(locale)) site.locale = locale;
    else problems.push(`locale: must be one of ${LOCALES.join(", ")}`);
  }

  const tagline = cleanText(input.tagline, LIMITS.tagline);
  if (tagline) site.tagline = tagline;

  const intro = cleanText(input.intro, LIMITS.intro);
  if (intro) site.intro = intro;

  const logo = cleanUrl(input.logo, "logo", problems);
  if (logo) site.logo = logo;

  const owner = cleanText(input.owner, LIMITS.owner);
  if (owner) site.owner = owner;

  const contact = cleanText(input.contact, LIMITS.contact);
  if (contact) site.contact = contact;

  const region = cleanRegion(input.region, problems);
  if (region) site.region = region;

  if (input.timezone != null && input.timezone !== "") {
    const timezone = String(input.timezone).trim();
    if (!validTimeZone(timezone)) problems.push(`timezone: unknown "${timezone}"`);
    else site.timezone = timezone;
  }

  const tags = cleanTags(input.tags, problems);
  if (tags) site.tags = tags;

  // 门户必须能显示一个名字；其余都可以空着。
  if (!site.name) problems.push("name: required");

  // 只有「没有名字」才整份丢弃：其余问题的字段已经在上面的清洗里丢掉了，
  // 能用的字段照收。否则伙伴多写一个未知字段就会让整份档案停在旧版本。
  return { ok: problems.length === 0, problems, site: site.name ? site : null };
}

/**
 * 校验签发区。中枢登记表里的每一条都要过这一关。
 * @param {unknown} instance
 * @param {Set<string>} [seen]
 * @returns {string[]}
 */
export function checkIssued(instance, seen = new Set()) {
  const errors = [];
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) return ["instance: must be an object"];

  for (const key of Object.keys(instance)) {
    if (!ISSUED_FIELDS.includes(key)) errors.push(`${key}: unknown field — 自述区不写在这里`);
  }

  const id = instance.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    errors.push("id: must be 2-32 chars, lowercase letters, digits, hyphens");
  } else if (seen.has(id)) {
    errors.push(`id: duplicate "${id}"`);
  } else {
    seen.add(id);
  }

  // 清单只收中枢签发出来的地址：https://<标签>.xknot.si。
  // 短号（< 6 位）照样放行；长度与保留名在签发时才判。
  if (!isHttpsUrl(instance.url)) errors.push("url: must be https");
  else if (!labelFromUrl(instance.url)) errors.push(`url: must be https://<label>${HUB_SUFFIX}`);

  if (typeof instance.since !== "string" || !DATE_RE.test(instance.since)) errors.push("since: must be YYYY-MM-DD");
  if (!TIERS.includes(instance.tier)) errors.push(`tier: must be one of ${TIERS.join(", ")}`);
  if (!STATUSES.includes(instance.status)) errors.push(`status: must be one of ${STATUSES.join(", ")}`);

  for (const key of ["cardsUrl", "statsUrl"]) {
    const value = instance[key];
    if (value == null) continue;
    if (!isHttpsUrl(value)) errors.push(`${key}: must be https or omitted`);
  }

  return errors;
}
