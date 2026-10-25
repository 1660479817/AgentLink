import { ref } from "vue";
import { DEFAULT_SITE_LOCALE } from "@knot/locale";
// JSON 必须带 import attribute：Vite 认这个写法，Node 直接跑测试时也才认得。
import en from "./locales/en.json" with { type: "json" };
import zhCN from "./locales/zh-CN.json" with { type: "json" };
import zhTW from "./locales/zh-TW.json" with { type: "json" };
import { bootLocale, PIN_KEY, readStored } from "../locale.js";

const catalogs = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
};

/**
 * 目录缺一个键时回到哪一份。它不是访客看到的默认语种：
 * 那个由站点默认（主理人设）与这个人自己的选择决定，见 `../locale.js`。
 */
export const defaultLocale = DEFAULT_SITE_LOCALE;

function browserStorage() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

const storage = browserStorage();
export const locale = ref(bootLocale(readStored(storage, PIN_KEY)));

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
      // 不用 String.replaceAll：它在 Safari 13.1 / Chrome 85 之前不存在，
      // 而微信内置浏览器可能比这更老。split/join 行为一致，也没有兼容门槛。
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
