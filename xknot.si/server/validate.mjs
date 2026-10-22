// 申请表的字段校验。
//
// 纯函数：输入表单对象，输出清洗后的值与按字段归类的错误码。
// 错误码是稳定的英文标识，页面自己按语种翻译，接口不回中文。
//
// 接入只有一种形态：中枢签发 <标签>.xknot.si，静态与动态都落在中枢入口。
// 已经有自有域名的站点不需要这一步，也不在这里登记，见 docs/JOIN.md。
//
// 子域规则只认 ops/subdomain.mjs 一份：端侧预检、控制台、接口都读同一个结论。
//
// 上限对着 ops/validate-instances.mjs 的规则：清单不过就不能发布。

import { isCountryCode } from "../web/src/lib/regions.js";
import { checkLabel, normalizeLabel } from "../ops/subdomain.mjs";

// 中枢自己的域名。签发出来的地址都挂在它下面。
export const HUB_DOMAIN = "xknot.si";

export const LIMITS = {
  name: 40,
  operator: 80,
  email: 120,
  intro: 60,
  tags: 9,
  tagLength: 16,
  note: 200,
};

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

function text(value, max) {
  return typeof value === "string" ? [...value.trim()].slice(0, max + 1).join("") : "";
}

export function subdomainUrl(subdomain) {
  return `https://${subdomain}.${HUB_DOMAIN}`;
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

  // 接入只有签发子域一种。旧客户端若还带着旧模式或自有域名，明确退回，
  // 不悄悄忽略：它会以为自己申请了自有域名，实际上什么都没登记。
  if (raw.mode != null && raw.mode !== "" && raw.mode !== "subdomain") errors.mode = "not_supported";
  if (String(raw.domain || "").trim()) errors.domain = "not_supported";

  const label = normalizeLabel(raw.subdomain);
  const checkedLabel = label ? checkLabel(label) : { available: false, reason: "empty" };
  if (!label) errors.subdomain = "required";
  else if (!checkedLabel.available) errors.subdomain = checkedLabel.reason;
  const subdomain = checkedLabel.available ? label : "";

  const url = subdomain ? subdomainUrl(subdomain) : "";

  const operator = text(raw.operator, LIMITS.operator);
  if (!operator) errors.operator = "required";
  else if ([...operator].length > LIMITS.operator) errors.operator = "too_long";

  const email = text(raw.email, LIMITS.email).toLowerCase();
  if (!email) errors.email = "required";
  else if (!EMAIL_RE.test(email)) errors.email = "invalid_email";

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
    value: { name, subdomain: subdomain || null, url, operator, email, region, timezone, intro, tags },
  };
}
