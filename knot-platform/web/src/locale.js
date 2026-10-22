import { DEFAULT_SITE_LOCALE, isLocale } from "@knot/locale";

// 语言菜单里显示的名字走 i18n，标记本身只认这三个。
export const LOCALES = [
  { id: "zh-CN", nameKey: "locale.zh-CN" },
  { id: "zh-TW", nameKey: "locale.zh-TW" },
  { id: "en", nameKey: "locale.en" },
];

/** 这个人在这台浏览器上选过的语种。 */
export const PIN_KEY = "knot.locale";

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

/**
 * 首屏在会话接口回来之前就要定语言。
 * 只认这个人自己的选择；没有就用站点默认（会话回来后校准，期间只有启动屏）。
 */
export function bootLocale(pin) {
  return isLocale(pin) ? pin : DEFAULT_SITE_LOCALE;
}

/**
 * 用户自己的选择赢过站点默认；站点默认赢过唯一的占位常量。
 * 没有第三条来源：不按 IP、不按 Accept-Language、不按浏览器语言。
 * `sync` 表示这个选择只存在浏览器里，应该写进账号。
 * @param {{ account?: string | null, pin?: string | null, site?: string | null }} input
 */
export function resolveLocale({ account, pin, site } = {}) {
  const chosen = isLocale(account) ? account : isLocale(pin) ? pin : null;
  if (chosen) return { locale: chosen, pin: true, sync: account ? null : chosen };
  return { locale: isLocale(site) ? site : DEFAULT_SITE_LOCALE, pin: false, sync: null };
}
