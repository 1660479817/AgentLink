// 站点档案：主理人自己写的那一半（自述区）。
//
// 文件在 sites/<站点>/profile.json，结构见 docs/PROFILE.md：
//   { "formatVersion": 1, "updatedAt": "YYYY-MM-DD", "profile": { ... } }
//
// 另一半（签发区：id、url、since、tier、status）由中枢决定，写在
// sites/<站点>/xknot.env，这里只读它、不写。两半合起来就是
// GET /api/federation/profile 返回的那一份，也是中枢取回的输入。
//
// 校验规则以 xknot.si/ops/profile-schema.mjs 为准。实例侧只做同一套规则的
// 最小实现：多语种白名单、长度上限、https 地址、时区与地区码。

import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const FORMAT_VERSION = 1;
export const LOCALE_IDS = ["zh-CN", "zh-TW", "en"];

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

const FIELDS = [
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

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** 站点没交档案时用它：留空，让 WebUI 用自己的兜底。 */
export const EMPTY_PROFILE = Object.freeze({
  name: null,
  intro: null,
  contact: null,
});

/**
 * 自述区文件的位置：和接入件 xknot.env 放在同一个站点目录。
 * 部署脚本把 KNOT_AGENT_ENV_DIR 写成 <部署根>/sites/<站点>/agents，
 * 它的上级目录就是站点目录；也可以用 KNOT_PROFILE_FILE 直接指定。
 */
export function profileFilePath(env = process.env, agentEnvDir = null) {
  const explicit = String(env.KNOT_PROFILE_FILE || "").trim();
  if (explicit) return path.resolve(explicit);
  const dir = String(agentEnvDir || "").trim();
  if (dir) return path.join(path.dirname(dir), "profile.json");
  return null;
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

function isCountryCode(value) {
  return typeof value === "string" && /^[A-Z]{2}$/.test(value);
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
    if (!LOCALE_IDS.includes(key)) {
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
    if (!LOCALE_IDS.includes(key)) {
      problems.push(`tags.${key}: unknown locale`);
      continue;
    }
    if (!Array.isArray(list)) {
      problems.push(`tags.${key}: must be an array`);
      continue;
    }
    const tags = list.map((raw) => cleanText(raw, LIMITS.tag)).filter(Boolean);
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
 * 清洗一份自述区。有问题的字段被丢掉，问题列在 problems 里。
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
    if (!FIELDS.includes(key)) problems.push(`${key}: unknown field, remove it`);
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

  const intro = input.intro && typeof input.intro === "object" && !Array.isArray(input.intro) ? input.intro : {};
  for (const key of Object.keys(intro)) {
    if (key !== "oneLine" && key !== "long") problems.push(`intro.${key}: unknown field, remove it`);
  }
  const oneLine = cleanLocaleMap(intro.oneLine, LIMITS.oneLine, {
    required: true,
    field: "intro.oneLine",
    problems,
  });
  const long = cleanLocaleMap(intro.long, LIMITS.long, { field: "intro.long", problems });
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
        if (!LOCALE_IDS.includes(tag)) problems.push(`languages: unknown locale "${tag}"`);
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
        if (!isCountryCode(code) && code !== "GLOBAL") problems.push(`regions: unknown code "${code}"`);
        else if (!regions.includes(code)) regions.push(code);
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

  // 门户必须能显示一个名字和一句介绍；联系方式可选。
  for (const field of ["name", "intro"]) {
    if (!profile[field]) problems.push(`${field}: required`);
  }

  return { ok: problems.length === 0, problems, profile: problems.length ? null : profile };
}

/**
 * 把档案里的多语种字段按当前语种取一个字符串，回退链见 docs/I18N.md：
 * 当前语种 → en → zh-CN → 任意有值的语种。
 * @param {Record<string, string> | null | undefined} map
 * @param {string} locale
 */
export function pickLocale(map, locale) {
  if (!map || typeof map !== "object") return "";
  const order = [locale, "en", "zh-CN", "zh-TW"];
  for (const key of order) {
    const value = map[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const first = Object.values(map).find((value) => typeof value === "string" && value.trim());
  return first ? first.trim() : "";
}

/** WebUI 与分享图要的站点身份：名称、标语、logo、主理人、联系与长介绍。 */export function brandView(profile) {
  const source = profile || {};
  return {
    name: source.name || null,
    tagline: source.intro?.oneLine || null,
    logo: source.logo || "",
    owner: source.owner || null,
    intro: source.intro?.long || null,
    contact: source.contact || "",
    themeColor: source.themeColor || "",
  };
}

/**
 * 同步读一份档案，只给分享图这类同步路径用。读不到就是空档案。
 * @param {string | null} file
 */
export function readProfileSync(file, { readFile = readFileSync } = {}) {
  if (!file) return { profile: null, updatedAt: null };
  try {
    const payload = JSON.parse(readFile(file, "utf8"));
    if (payload?.formatVersion !== FORMAT_VERSION) return { profile: null, updatedAt: null };
    const cleaned = cleanProfile(payload.profile);
    return {
      profile: cleaned.profile || (cleaned.problems.length ? payload.profile : null),
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
    };
  } catch {
    return { profile: null, updatedAt: null };
  }
}

/**
 * 读、写、缓存一个站点的档案。文件不存在不是错误：站点可以一直不填自述区。
 * @param {{ file: string | null }} options
 */
export function createProfileStore({ file = null } = {}) {
  let state = { profile: null, updatedAt: null, problems: [], loaded: false };

  async function reload() {
    if (!file) {
      state = { profile: null, updatedAt: null, problems: [], loaded: true };
      return state;
    }
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        state = { profile: null, updatedAt: null, problems: [], loaded: true };
        return state;
      }
      state = { profile: null, updatedAt: null, problems: [`profile: ${error.code || "read_failed"}`], loaded: true };
      return state;
    }
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      state = { profile: null, updatedAt: null, problems: ["profile: file is not valid JSON"], loaded: true };
      return state;
    }
    if (payload?.formatVersion !== FORMAT_VERSION) {
      state = {
        profile: null,
        updatedAt: null,
        problems: [`formatVersion: must be ${FORMAT_VERSION}`],
        loaded: true,
      };
      return state;
    }
    const cleaned = cleanProfile(payload.profile);
    state = {
      // 有字段级问题时也保留能用的部分，页面不至于整块空白。
      profile: cleaned.problems.length ? partialProfile(payload.profile) : cleaned.profile,
      updatedAt: typeof payload.updatedAt === "string" ? payload.updatedAt : null,
      problems: cleaned.problems,
      loaded: true,
    };
    return state;
  }

  // 清洗失败时仍尽量给出一份可显示的档案：只做类型过滤，不抛错。
  function partialProfile(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const out = {};
    for (const key of ["name", "shortName", "operator", "owner"]) {
      if (raw[key] && typeof raw[key] === "object" && !Array.isArray(raw[key])) out[key] = raw[key];
    }
    if (raw.intro && typeof raw.intro === "object") {
      out.intro = {};
      if (raw.intro.oneLine && typeof raw.intro.oneLine === "object") out.intro.oneLine = raw.intro.oneLine;
      if (raw.intro.long && typeof raw.intro.long === "object") out.intro.long = raw.intro.long;
    }
    if (typeof raw.logo === "string") out.logo = raw.logo;
    if (typeof raw.contact === "string") out.contact = raw.contact;
    if (typeof raw.themeColor === "string") out.themeColor = raw.themeColor;
    if (Array.isArray(raw.social)) out.social = raw.social;
    return out;
  }

  function view() {
    return state;
  }

  /**
   * 整份替换自述区。校验不过一个字节都不写。
   * @param {{ profile: unknown, updatedAt?: string }} input
   */
  async function save(input, { now = () => new Date() } = {}) {
    if (!file) {
      const error = new Error("profile_unconfigured");
      error.code = "profile_unconfigured";
      throw error;
    }
    const cleaned = cleanProfile(input?.profile);
    if (!cleaned.ok || !cleaned.profile) {
      const error = new Error("bad_profile");
      error.code = "bad_profile";
      error.problems = cleaned.problems.length ? cleaned.problems : ["profile: required"];
      throw error;
    }
    const payload = {
      formatVersion: FORMAT_VERSION,
      updatedAt: now().toISOString().slice(0, 10),
      profile: cleaned.profile,
    };
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await rename(tmp, file);
    await reload();
    return view();
  }

  return { reload, view, save, file };
}
