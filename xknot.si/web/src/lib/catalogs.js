import en from "../locales/en.json";
import zhCN from "../locales/zh-CN.json";
import zhTW from "../locales/zh-TW.json";
import { DEFAULT_LOCALE, makeT } from "./i18n.js";

export const catalogs = {
  en,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
};

export function catalogFor(locale) {
  return catalogs[locale] || catalogs[DEFAULT_LOCALE];
}

// 当前语种的取词函数，英文作为回退。
export function tFor(locale) {
  return makeT(catalogFor(locale), catalogs[DEFAULT_LOCALE]);
}
