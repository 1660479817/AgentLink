// 站点档案（L1）的字段契约。
//
// L1 现在装在两处：
//   * 签发区 issued —— 中枢决定：id、url、since、tier、status。写在 xknot.si/instances.json。
//   * 自述区 profile —— 主理人决定：名称、介绍、联系方式等。写在实例自己的 profile.json，
//     由中枢按 url 取回，副本落 var/profiles/{id}.json。
//
// 这个模块是自述区唯一的校验实现。中枢取回时校验，门户构建时也按它清洗；
// 实例侧有一份自己的最小校验（knot-platform/backend/src/profile.js），
// 两边规则以本文件为准，见 docs/FEDERATION.md 第 4 节。

import { LOCALES as LOCALE_IDS } from "../web/src/lib/i18n.js";
import { isCountryCode } from "../web/src/lib/regions.js";

export const FORMAT_VERSION = 1;

export const LIMITS = {
  name: 40,
  shortName: 12,
  operator: 80,
  owner: 40,
  oneLine: 60,
  long: 800,
  tag: 32,
  tags: 5,
  contact: 120,
  url: 300,
  color: 7,
  vertical: 32,
  social: 5,
  socialLabel: 32,
};

export const TIERS = ["demo", "partner", "community"];
export const STATUSES = ["pending", "active", "suspended", "retired"];

const ISSUED_FIELDS = ["id", "url", "since", "tier", "status", "cardsUrl", "statsUrl"];
const PROFILE_FIELDS = [
  "name",
  "shortName",
  "logo",
  "themeColor",
  "vertical",
  "tags",
  "languages",
  "regions",
  "timezone",
  "operator",
  "owner",
  "intro",
  "contact",
  "social",
  "termsUrl",
  "privacyUrl",
  "moderationUrl",
];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function isLocale(value) {
  return LOCALE_IDS.includes(value);
}

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

// 多语种字段：只留白名单里的语种，空字符串等于没写。
// required 为真时至少要有一个语种有值。
function cleanLocaleMap(value, max, { required = false, field, problems }) {
  if (value == null) {
    if (required) problems.push(`${field}: required`);
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push(`${field}: must be a locale map, not a plain value`);
    return null;
  }
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isLocale(key)) {
      problems.push(`${field}.${key}: unknown locale`);
      continue;
    }
    const text = cleanText(raw, max);
    if (!text) {
      problems.push(`${field}.${key}: empty string, omit the key instead`);
      continue;
    }
    out[key] = text;
  }
  if (!Object.keys(out).length) {
    if (required) problems.push(`${field}: required`);
    return null;
  }
  // en 不是必填：缺了按 I18N.md 的回退链取有值的语种。这里只提示，不拦。
  return out;
}

function cleanTags(value, problems) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    problems.push("tags: must be a locale map of string arrays");
    return null;
  }
  const out = {};
  for (const [key, list] of Object.entries(value)) {
    if (!isLocale(key)) {
      problems.push(`tags.${key}: unknown locale`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`tags.${key}: must be an array`);
      continue;
    }
    const tags = [];
    for (const raw of list) {
      const tag = cleanText(raw, LIMITS.tag);
      if (tag) tags.push(tag);
    }
    if (tags.length > LIMITS.tags) {
      problems.push(`tags.${key}: more than ${LIMITS.tags}`);
      continue;
    }
    if (tags.length) out[key] = tags;
  }
  return Object.keys(out).length ? out : null;
}

function cleanSocial(value, problems) {
  if (value == null) return null;
  if (!Array.isArray(value)) {
    problems.push("social: must be an array");
    return null;
  }
  if (value.length > LIMITS.social) {
    problems.push(`social: more than ${LIMITS.social}`);
    return null;
  }
  const out = [];
  for (const [index, item] of value.entries()) {
    const label = cleanText(item?.label, LIMITS.socialLabel);
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!label) problems.push(`social[${index}].label: required`);
    if (!isHttpsUrl(url)) problems.push(`social[${index}].url: must be https`);
    if (!label || !isHttpsUrl(url)) continue;
    out.push({ label, url });
  }
  return out.length ? out : null;
}

function cleanNullableUrl(value, field, problems) {
  if (value == null || value === "") return null;
  if (!isHttpsUrl(value)) {
    problems.push(`${field}: must be https, or null`);
    return null;
  }
  if (lengthOf(String(value)) > LIMITS.url) {
    problems.push(`${field}: longer than ${LIMITS.url}`);
    return null;
  }
  return String(value).trim();
}

/**
 * 清洗一份自述区。返回可以直接落盘的 profile，以及发现的问题。
 * 有问题的字段会被丢掉（或置空），调用方决定是保留上一份还是照此发布。
 * @param {unknown} input
 * @returns {{ ok: boolean, problems: string[], profile: object | null }}
 */
export function cleanProfile(input) {
  const problems = [];
  if (input == null) return { ok: true, problems, profile: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, problems: ["profile: must be a JSON object"], profile: null };
  }

  for (const key of Object.keys(input)) {
    if (!PROFILE_FIELDS.includes(key)) problems.push(`${key}: unknown field, remove it`);
  }

  const profile = {};

  const name = cleanLocaleMap(input.name, LIMITS.name, { required: true, field: "name", problems });
  if (name) profile.name = name;

  const shortName = cleanLocaleMap(input.shortName, LIMITS.shortName, { field: "shortName", problems });
  if (shortName) profile.shortName = shortName;

  const operator = cleanLocaleMap(input.operator, LIMITS.operator, { field: "operator", problems });
  if (operator) profile.operator = operator;

  const owner = cleanLocaleMap(input.owner, LIMITS.owner, { field: "owner", problems });
  if (owner) profile.owner = owner;

  const introInput = input.intro && typeof input.intro === "object" && !Array.isArray(input.intro) ? input.intro : {};
  for (const key of Object.keys(introInput)) {
    if (key !== "oneLine" && key !== "long") problems.push(`intro.${key}: unknown field, remove it`);
  }
  const oneLine = cleanLocaleMap(introInput.oneLine, LIMITS.oneLine, {
    required: true,
    field: "intro.oneLine",
    problems,
  });
  const long = cleanLocaleMap(introInput.long, LIMITS.long, { field: "intro.long", problems });
  if (oneLine || long) profile.intro = { ...(oneLine ? { oneLine } : {}), ...(long ? { long } : {}) };

  const logo = cleanNullableUrl(input.logo, "logo", problems);
  if (logo) profile.logo = logo;

  if (input.themeColor != null) {
    const color = String(input.themeColor).trim();
    if (!COLOR_RE.test(color)) problems.push("themeColor: must be #RRGGBB");
    else profile.themeColor = color;
  }

  if (input.vertical != null) {
    const vertical = cleanText(input.vertical, LIMITS.vertical);
    if (!vertical) problems.push("vertical: must be a short string");
    else profile.vertical = vertical;
  }

  const tags = cleanTags(input.tags, problems);
  if (tags) profile.tags = tags;

  if (input.languages != null) {
    if (!Array.isArray(input.languages) || !input.languages.length) {
      problems.push("languages: must be a non-empty array");
    } else {
      const languages = [];
      for (const tag of input.languages) {
        if (!isLocale(tag)) problems.push(`languages: unknown locale "${tag}"`);
        else if (!languages.includes(tag)) languages.push(tag);
      }
      if (languages.length) profile.languages = languages;
    }
  }

  if (input.regions != null) {
    if (!Array.isArray(input.regions) || !input.regions.length) {
      problems.push("regions: must be a non-empty array");
    } else {
      const regions = [];
      for (const code of input.regions) {
        if (typeof code !== "string" || (!isCountryCode(code) && code !== "GLOBAL")) {
          problems.push(`regions: unknown code "${code}"`);
        } else if (!regions.includes(code)) {
          regions.push(code);
        }
      }
      if (regions.includes("GLOBAL") && regions.length > 1) problems.push("regions: GLOBAL must be used alone");
      else if (regions.length) profile.regions = regions;
    }
  }

  if (input.timezone != null) {
    const timezone = String(input.timezone).trim();
    if (!validTimeZone(timezone)) problems.push(`timezone: unknown "${timezone}"`);
    else profile.timezone = timezone;
  }

  if (input.contact != null) {
    const contact = cleanText(input.contact, LIMITS.contact);
    if (!contact) problems.push("contact: must be a non-empty string, or omit it");
    else profile.contact = contact;
  }

  const social = cleanSocial(input.social, problems);
  if (social) profile.social = social;

  for (const field of ["termsUrl", "privacyUrl", "moderationUrl"]) {
    const url = cleanNullableUrl(input[field], field, problems);
    if (url) profile[field] = url;
  }

  // 门户必须能显示一个名字和一句介绍；联系方式可选，主理人不想公开就不写。
  for (const field of ["name", "intro"]) {
    if (!profile[field]) problems.push(`${field}: required`);
  }

  return { ok: problems.length === 0, problems, profile: problems.length ? null : profile };
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

  if (!isHttpsUrl(instance.url)) errors.push("url: must be https");

  if (typeof instance.since !== "string" || !DATE_RE.test(instance.since)) errors.push("since: must be YYYY-MM-DD");
  if (!TIERS.includes(instance.tier)) errors.push(`tier: must be one of ${TIERS.join(", ")}`);
  if (!STATUSES.includes(instance.status)) errors.push(`status: must be one of ${STATUSES.join(", ")}`);

  for (const key of ["cardsUrl", "statsUrl"]) {
    const value = instance[key];
    if (value == null) continue;
    if (!isHttpsUrl(value)) errors.push(`${key}: must be https or omitted`);  }

  return errors;
}
