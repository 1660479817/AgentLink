// 申请表的字段校验。
//
// 纯函数：输入表单对象，输出清洗后的值与按字段归类的错误码。
// 错误码是稳定的英文标识，页面自己按语种翻译，接口不回中文。
//
// 只有两种接入模式，二选一：
//   own-domain —— 站点已经有自己的域名，地址就是它，中枢不签发、不跳转。
//   subdomain  —— 站点没有域名，由中枢签发 <标签>.xknot.si，静态与动态都落在中枢入口。
//
// 模式直接决定地址：own-domain 用伙伴的域名，subdomain 用签发的子域。
//
// 上限对着 ops/validate-instances.mjs 的规则：清单不过就不能发布。

import { isIP } from "node:net";

import { isCountryCode } from "../web/src/lib/regions.js";

// 中枢自己的域名。只有 subdomain 模式的地址挂在它下面。
export const HUB_DOMAIN = "xknot.si";

export const LIMITS = {
  name: 40,
  operator: 80,
  email: 120,
  subdomain: 32,
  domain: 253,
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

// 自有域名只接受完整主机名：至少两段、每段 1–63 位、不含下划线。
const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export const MODES = ["own-domain", "subdomain"];

function text(value, max) {
  return typeof value === "string" ? [...value.trim()].slice(0, max + 1).join("") : "";
}

/**
 * 把用户填的东西收成一个子域标签。
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

/**
 * 把用户填的自有域名收成规范地址。
 *
 * 接受 `https://example.com/`、`example.com`、`HTTP://EXAMPLE.COM:8443/path`：
 * 只保留 origin，统一 https、去掉末尾斜杠。以下一律拒绝：
 *   - 带账号密码、查询串或片段
 *   - IP 字面量（没有域名就没有证书语义，不属于这种模式）
 *   - localhost、`.local`、单段主机名
 *   - 中枢自己的域名（那属于 subdomain 模式）
 */
export function normalizeOwnDomain(value) {
  let raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) raw = `https://${raw}`;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "";
  }
  if (url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  if (url.search || url.hash) return "";

  const host = url.hostname.toLowerCase();
  if (!HOST_RE.test(host)) return "";
  if (isIP(host)) return "";
  if (host === HUB_DOMAIN || host.endsWith(`.${HUB_DOMAIN}`)) return "";
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return "";

  const port = url.port ? `:${url.port}` : "";
  return `https://${host}${port}`;
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

  const mode = MODES.includes(raw.mode) ? raw.mode : "";
  if (!mode) errors.mode = "required";

  // 两种模式各要一个地址字段；另一个留空，不互相兜底。
  const subdomain = mode === "subdomain" ? normalizeSubdomain(raw.subdomain) : "";
  const domain = mode === "own-domain" ? normalizeOwnDomain(raw.domain) : "";

  if (mode === "subdomain") {
    if (!subdomain) errors.subdomain = "invalid";
    else if (RESERVED_SUBDOMAINS.has(subdomain)) errors.subdomain = "reserved";
  }
  if (mode === "own-domain" && !domain) errors.domain = "invalid";

  const url = mode === "subdomain" ? (subdomain ? subdomainUrl(subdomain) : "") : domain;

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
    value: { name, mode, domain: domain || null, subdomain: subdomain || null, url, operator, email, region, timezone, intro, tags },
  };
}
