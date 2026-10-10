import zh from "./locales/zh.json";

const catalogs = { zh };

/** @type {'zh'} */
export const defaultLocale = "zh";

let locale = defaultLocale;

export function setLocale(next) {
  if (catalogs[next]) locale = next;
}

export function getLocale() {
  return locale;
}

/**
 * @param {string} key dot path, e.g. "nav.home"
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  const parts = key.split(".");
  let node = catalogs[locale];
  for (const p of parts) {
    node = node?.[p];
  }
  let text = typeof node === "string" ? node : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replaceAll(`{${k}}`, String(v));
    }
  }
  return text;
}
