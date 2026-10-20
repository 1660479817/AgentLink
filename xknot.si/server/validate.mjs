// 申请表的字段校验。
//
// 纯函数：输入表单对象，输出清洗后的值与按字段归类的错误码。
// 错误码是稳定的英文标识，页面自己按语种翻译，接口不回中文。
//
// 申请只按子域走：申请人选一个标签，地址由中枢拼成 `<标签>.xknot.si`。
// 站点落在哪里是另一件事（`requestAccess`），不影响身份。
//
// 上限对着 ops/validate-instances.mjs 的规则：清单不过就不能发布。

import { isCountryCode } from "../web/src/lib/regions.js";

// 中枢自己的域名。签发出来的实例地址都挂在它下面。
export const HUB_DOMAIN = "xknot.si";

export const LIMITS = {
  name: 40,
  operator: 80,
  email: 120,
  subdomain: 32,
  intro: 60,
  tags: 5,
  tagLength: 20,
  note: 200,
};

// 系统自用与品牌保护的名字，一律不签发。
// 这份表只挡「明显会被中枢自己用掉」或「容易被当成官方」的标签；
// 商标与冒充仍由人工审核判断，不在这里穷举。
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "admin",
  "mail",
  "smtp",
  "imap",
  "pop",
  "pop3",
  "mx",
  "ns",
  "ns1",
  "ns2",
  "dns",
  "cdn",
  "static",
  "assets",
  "asset",
  "img",
  "media",
  "files",
  "download",
  "uploads",
  "docs",
  "help",
  "support",
  "status",
  "health",
  "blog",
  "dev",
  "test",
  "staging",
  "demo",
  "preview",
  "hub",
  "xknot",
  "root",
  "sys",
  "system",
  "internal",
  "app",
  "web",
  "id",
  "auth",
  "login",
  "sso",
  "account",
  "billing",
  "pay",
  "relay",
  "gateway",
]);

// 2–32 位，小写字母/数字/连字符，首尾必须是字母或数字。
// 这条规则与清单里的实例 id 一致，签发后可以直接当 id 用。
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])$/;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export const ACCESS_MODES = ["direct", "tunnel"];

function text(value, max) {
  return typeof value === "string" ? [...value.trim()].slice(0, max + 1).join("") : "";
}

/**
 * 把用户填的东西收成一个标签。
 *
 * 允许粘贴整条地址或带后缀的写法（`https://travel.xknot.si/`、`travel.xknot.si`），
 * 统一取出最左边那一段；取不出合法标签时返回空串。
 */
export function normalizeSubdomain(value) {
  let raw = String(value || "").trim().toLowerCase();
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  raw = raw.replace(/[/?#].*$/, "");
  raw = raw.replace(/:\d+$/, "");
  const suffix = `.${HUB_DOMAIN}`;
  if (raw.endsWith(suffix)) raw = raw.slice(0, -suffix.length);
  return SUBDOMAIN_RE.test(raw) ? raw : "";
}

export function subdomainUrl(subdomain) {
  return `https://${subdomain}.${HUB_DOMAIN}`;
}

// 从一条已经存在的地址里取标签，供老数据读回。
export function subdomainOfUrl(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    const suffix = `.${HUB_DOMAIN}`;
    if (!host.endsWith(suffix)) return null;
    const label = host.slice(0, -suffix.length);
    return SUBDOMAIN_RE.test(label) ? label : null;
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

  // 只认子域标签。老客户端发 url 时也按标签解析，解析不出就报同一格。
  const subdomain = normalizeSubdomain(raw.subdomain ?? raw.url);
  if (!subdomain) errors.subdomain = "invalid";
  else if (RESERVED_SUBDOMAINS.has(subdomain)) errors.subdomain = "reserved";

  const access = ACCESS_MODES.includes(raw.requestAccess) ? raw.requestAccess : "";
  if (!access) errors.access = "required";

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
    value: { name, subdomain, requestAccess: access, operator, email, region, timezone, intro, tags },
  };
}
