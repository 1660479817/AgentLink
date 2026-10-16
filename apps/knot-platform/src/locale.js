export const LOCALES = ["zh-CN", "zh-TW", "en"];

export function parseLocale(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return LOCALES.includes(text) ? text : null;
}

/** Cloudflare country code, or "" when the edge did not send one. */
export function countryFromRequest(req) {
  return String(req.get?.("cf-ipcountry") || "").trim().toUpperCase();
}

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

export function regionForRequest(req) {
  return localeFromCountry(countryFromRequest(req));
}
