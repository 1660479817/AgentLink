import { ref } from "vue";
import en from "./locales/en.json";
import zhCN from "./locales/zh-CN.json";
import zhTW from "./locales/zh-TW.json";
import { bootLocale, PIN_KEY, readStored, SEEN_KEY } from "../locale.js";

const catalogs = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

export const defaultLocale = "zh-CN";

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

const storage = browserStorage();
export const locale = ref(bootLocale(readStored(storage, PIN_KEY), readStored(storage, SEEN_KEY)));

function applyLang(value) {
  if (typeof document !== "undefined") document.documentElement.lang = value;
}

applyLang(locale.value);

export function setLocale(next) {
  if (!catalogs[next]) return;
  locale.value = next;
  applyLang(next);
}

function lookup(catalog, parts) {
  let node = catalog;
  for (const part of parts) node = node?.[part];
  return typeof node === "string" ? node : null;
}

/**
 * @param {string} key dot path, e.g. "nav.mine"
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  const parts = key.split(".");
  const primary = catalogs[locale.value] || catalogs[defaultLocale];
  let text = lookup(primary, parts) ?? lookup(catalogs[defaultLocale], parts) ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
