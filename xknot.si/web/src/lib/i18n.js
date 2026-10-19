// 中枢门户的语种与文案。规则见 docs/I18N.md。
//
// 这里只有纯函数：不读 navigator、不读 localStorage、不发请求。
// 门户按路径前缀决定语种，语言切换是普通链接。

export const LOCALES = ["en", "zh-CN", "zh-TW"];
export const DEFAULT_LOCALE = "en";

export function isLocale(value) {
  return LOCALES.includes(value);
}

function normalize(tag) {
  if (typeof tag !== "string") return null;
  const cleaned = tag.trim().replace(/_/g, "-");
  if (!cleaned) return null;
  // 精确匹配优先（大小写不敏感）：zh-tw → zh-TW
  const exact = LOCALES.find((locale) => locale.toLowerCase() === cleaned.toLowerCase());
  if (exact) return exact;
  // 只有基础语时取第一个同语种：zh → zh-CN
  const base = cleaned.split("-")[0].toLowerCase();
  const byBase = LOCALES.find((locale) => locale.split("-")[0].toLowerCase() === base);
  return byBase || null;
}

// 按优先级取第一个支持的语种；都不支持就用默认语种。
export function resolveLocale(preferred) {
  const list = Array.isArray(preferred) ? preferred : [preferred];
  for (const tag of list) {
    const locale = normalize(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

// 回退链：本语种 → 基础语（zh-CN → zh）→ en → 清单里第一个有值的语种。
export function pickLocalized(map, locale = DEFAULT_LOCALE) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return null;
  const wanted = normalize(locale) || DEFAULT_LOCALE;

  const direct = map[wanted];
  if (isNonEmpty(direct)) return direct;

  const base = wanted.split("-")[0];
  if (base !== wanted) {
    for (const key of Object.keys(map)) {
      if (key.split("-")[0] === base && isNonEmpty(map[key])) return map[key];
    }
  }

  if (isNonEmpty(map[DEFAULT_LOCALE])) return map[DEFAULT_LOCALE];

  for (const key of Object.keys(map)) {
    if (isNonEmpty(map[key])) return map[key];
  }
  return null;
}

function isNonEmpty(value) {
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return value != null;
}

// 当前路径的语种前缀链接：/en/、/zh-CN/。
export function localeHref(locale, page = "/") {
  const suffix = page.startsWith("/") ? page.slice(1) : page;
  return `/${normalize(locale) || DEFAULT_LOCALE}/${suffix}`;
}

export function hreflangAlternates(page = "/") {
  const list = LOCALES.map((locale) => ({ hreflang: locale, href: localeHref(locale, page) }));
  list.push({ hreflang: "x-default", href: localeHref(DEFAULT_LOCALE, page) });
  return list;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// 相对时间按语种渲染；超过 7 天转绝对日期，并按时区计算。
export function formatWhen(value, locale = DEFAULT_LOCALE, options = {}) {
  const { now = new Date(), timeZone, style = "long" } = options;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const lang = normalize(locale) || DEFAULT_LOCALE;
  const diff = date.getTime() - now.getTime();

  if (Math.abs(diff) < SEVEN_DAYS_MS) {
    const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto", style });
    const minutes = Math.round(diff / 60000);
    if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
    const hours = Math.round(diff / 3600000);
    if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
    return rtf.format(Math.round(diff / 86400000), "day");
  }

  const fmt = new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
  return fmt.format(date);
}

// 键路径取值，缺了就返回 null，不把键名显示给用户。
export function translate(catalog, key, vars) {
  const parts = String(key).split(".");
  let node = catalog;
  for (const part of parts) node = node?.[part];
  if (typeof node !== "string") return null;
  if (!vars) return node;
  return node.replaceAll(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

// 当前语种的取词函数：先取本语种，再回退到英文，都没有就返回键名。
export function makeT(catalog, fallback = null) {
  return (key, vars) => translate(catalog, key, vars) ?? translate(fallback, key, vars) ?? key;
}
