export const LOCALE_IDS = ["zh-CN", "zh-TW", "en"];

export const LOCALES = [
  { id: "zh-CN", nameKey: "locale.zh-CN" },
  { id: "zh-TW", nameKey: "locale.zh-TW" },
  { id: "en", nameKey: "locale.en" },
];

export const PIN_KEY = "knot.locale";
export const SEEN_KEY = "knot.locale.seen";

export function isLocale(value) {
  return LOCALE_IDS.includes(value);
}

export function readStored(storage, key) {
  try {
    const value = storage?.getItem(key);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeStored(storage, key, value) {
  try {
    if (!storage) return;
    if (value == null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // private mode
  }
}

export function bootLocale(pin, seen, tags = navigatorTags()) {
  if (isLocale(pin)) return pin;
  if (isLocale(seen)) return seen;
  const hint = localeFromTags(tags);
  return isLocale(hint) ? hint : "en";
}

/**
 * 浏览器偏好里第一条简中 / 繁中 / 英文。首屏在会话接口回来之前就要定语言，
 * 这一眼比默认 en 准；导航先出英文、正文再变中文，读起来像半页没翻完。
 */
function localeFromTags(tags = []) {
  for (const tag of tags) {
    const value = String(tag || "").trim().toLowerCase();
    if (value.startsWith("zh")) return /hant|tw|hk|mo/.test(value) ? "zh-TW" : "zh-CN";
    if (value.startsWith("en")) return "en";
  }
  return "";
}

function navigatorTags() {
  if (typeof navigator === "undefined") return [];
  return [...(navigator.languages || []), navigator.language].filter(Boolean);
}

/**
 * Account choice wins. A choice saved in this browser is next.
 * Otherwise use the region suggested from the IP country.
 * `sync` is set when a browser choice should be written onto an account that has none.
 * @param {{ account?: string | null, pin?: string | null, region?: string | null }} input
 */
export function resolveLocale({ account, pin, region } = {}) {
  const saved = isLocale(account) ? account : null;
  const browser = isLocale(pin) ? pin : null;
  const suggested = isLocale(region) ? region : "en";
  if (saved) return { locale: saved, pin: true, sync: null };
  if (browser) return { locale: browser, pin: true, sync: browser };
  return { locale: suggested, pin: false, sync: null };
}
