// 管理后台的界面文案入口。页面不打包，也不引 WebUI 的 i18n 包：
// 这一页只带自己用到的键，三份语种放在 ./i18n/*.js。
//
// - 键名是 `section.key`；带插值的地方写 {name}，由 t(key, { name }) 替换。
// - 静态标记用 data-i18n / data-i18n-placeholder / data-i18n-aria-label / data-i18n-title，
//   由 applyI18n() 一次刷完；不拼 innerHTML。
// - 用户选的语种记在 localStorage，下次打开沿用；没选过就跟着浏览器语言走。

import zhCN from "./i18n/zh-CN.js";
import zhTW from "./i18n/zh-TW.js";
import en from "./i18n/en.js";

export const LOCALES = [
  { id: "zh-CN", label: "简体中文" },
  { id: "zh-TW", label: "繁體中文" },
  { id: "en", label: "English" },
];

const STORAGE_KEY = "knot.admin.locale";
const DEFAULT_LOCALE = "zh-CN";
const DICTS = { "zh-CN": zhCN, "zh-TW": zhTW, en };

function readSaved() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function detectLocale() {
  const saved = readSaved();
  if (DICTS[saved]) return saved;
  const tags =
    typeof navigator !== "undefined" ? navigator.languages || [navigator.language || ""] : [];
  for (const raw of tags) {
    const tag = String(raw || "").toLowerCase();
    if (tag.startsWith("zh")) return /hant|tw|hk|mo/.test(tag) ? "zh-TW" : "zh-CN";
    if (tag.startsWith("en")) return "en";
  }
  return DEFAULT_LOCALE;
}

let current = detectLocale();

export function locale() {
  return current;
}

export function isLocale(id) {
  return Boolean(DICTS[id]);
}

export function t(key, vars) {
  const table = DICTS[current] || DICTS[DEFAULT_LOCALE];
  const text = table[key] ?? DICTS[DEFAULT_LOCALE][key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

export function applyI18n(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope) return;
  for (const node of scope.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of scope.querySelectorAll("[data-i18n-placeholder]")) {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  }
  for (const node of scope.querySelectorAll("[data-i18n-aria-label]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  }
  for (const node of scope.querySelectorAll("[data-i18n-title]")) {
    node.setAttribute("title", t(node.dataset.i18nTitle));
  }
  if (typeof document !== "undefined") {
    document.documentElement.lang = current;
    document.title = t("meta.title");
  }
}

// 切语种只换文案，不动数据：调用方负责按新语种重绘当前栏。
export function setLocale(id) {
  if (!DICTS[id] || id === current) return false;
  current = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 隐私模式下写不进去就算了：这一页仍然按选中的语种显示。
  }
  applyI18n();
  return true;
}

export function fmtInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return number.toLocaleString(current, { maximumFractionDigits: 0 });
}

export function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(current, { hour12: false });
}

export function dictionary(id) {
  return DICTS[id] || null;
}
