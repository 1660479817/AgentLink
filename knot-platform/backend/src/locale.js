export const LOCALES = ["zh-CN", "zh-TW", "en"];

export function parseLocale(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return LOCALES.includes(text) ? text : null;
}

/** Cloudflare country code, or "" when the entry did not send one. */
export function countryFromRequest(req) {
  return String(req.get?.("cf-ipcountry") || "").trim().toUpperCase();
}

// Cloudflare 在拿不到国家时发 XX；T1 是 Tor。两者都不该当成一个真实地区。
const UNKNOWN_COUNTRIES = new Set(["", "XX", "T1"]);

/**
 * Mainland China uses simplified Chinese.
 * Taiwan, Hong Kong, and Macau use traditional Chinese.
 * A missing or unrecognized country uses English, as does every other known country.
 */
export function localeFromCountry(country) {
  const code = String(country || "").trim().toUpperCase();
  if (code === "CN") return "zh-CN";
  if (code === "TW" || code === "HK" || code === "MO") return "zh-TW";
  return "en";
}

/**
 * 没有国家码时的兜底。入口是直连 nginx（没有 Cloudflare 头），
 * 这条路径以前恒为 en，于是中国访客看到英文导航配中文正文。
 * 只认简中、繁中、英文；别的语种不猜，交给默认值。
 */
export function localeFromAcceptLanguage(header) {
  const tags = String(header || "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const quality = params.map((item) => item.trim()).find((item) => item.startsWith("q="));
      const q = quality ? Number(quality.slice(2)) : 1;
      return { tag: String(tag || "").toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((item) => item.tag && item.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of tags) {
    const [primary, ...rest] = tag.split("-");
    if (primary === "zh") return /hant|tw|hk|mo/.test(rest.join("-")) ? "zh-TW" : "zh-CN";
    if (primary === "en") return "en";
  }
  return "";
}

export function regionForRequest(req) {
  const country = countryFromRequest(req);
  if (!UNKNOWN_COUNTRIES.has(country)) return localeFromCountry(country);
  return localeFromAcceptLanguage(req.get?.("accept-language")) || "en";
}
