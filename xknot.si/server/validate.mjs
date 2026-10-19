// 申请表的字段校验。
//
// 纯函数：输入表单对象，输出清洗后的值与按字段归类的错误码。
// 错误码是稳定的英文标识，页面自己按语种翻译，接口不回中文。
//
// 上限对着 ops/validate-instances.mjs 的规则：清单不过就不能发布。

import { isCountryCode } from "../web/src/lib/regions.js";

export const LIMITS = {
  name: 40,
  operator: 80,
  email: 120,
  url: 200,
  intro: 60,
  tags: 5,
  tagLength: 20,
  note: 200,
};

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function text(value, max) {
  return typeof value === "string" ? [...value.trim()].slice(0, max + 1).join("") : "";
}

export function normalizeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    if (!url.hostname.includes(".")) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function normalizeTags(value) {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,，、\s]+/)
      : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const tag = text(item, LIMITS.tagLength);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function validTimeZone(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {{ ok: boolean, errors: Record<string,string>, value: object }}
 */
export function validateApplication(input) {
  const errors = {};
  const raw = input && typeof input === "object" ? input : {};

  const name = text(raw.name, LIMITS.name);
  if ([...name].length < 2) errors.name = "too_short";
  else if ([...name].length > LIMITS.name) errors.name = "too_long";

  const operator = text(raw.operator, LIMITS.operator);
  if (!operator) errors.operator = "required";
  else if ([...operator].length > LIMITS.operator) errors.operator = "too_long";

  const email = text(raw.email, LIMITS.email).toLowerCase();
  if (!email) errors.email = "required";
  else if (!EMAIL_RE.test(email)) errors.email = "invalid_email";

  const url = normalizeUrl(raw.url);
  if (!url) errors.url = "invalid_url";
  else if (url.length > LIMITS.url) errors.url = "too_long";

  const region = typeof raw.region === "string" ? raw.region.trim().toUpperCase() : "";
  if (!region) errors.region = "required";
  else if (!isCountryCode(region)) errors.region = "invalid_region";

  const timezone = typeof raw.timezone === "string" ? raw.timezone.trim() : "";
  if (!timezone) errors.timezone = "required";
  else if (!validTimeZone(timezone)) errors.timezone = "invalid_timezone";

  const intro = text(raw.intro, LIMITS.intro);
  if (!intro) errors.intro = "required";
  else if ([...intro].length > LIMITS.intro) errors.intro = "too_long";

  const tags = normalizeTags(raw.tags);
  if (tags.length > LIMITS.tags) errors.tags = "too_many_tags";

  if (raw.agree !== true) errors.agree = "required";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: { name, operator, email, url, region, timezone, intro, tags },
  };
}
