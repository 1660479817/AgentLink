// 站点档案里的多语种字段：{ "zh-CN": "…", en: "…" }。
//
// 回退链跟 Backend 的 pickLocale 一致：当前语种 → en → zh-CN → zh-TW → 任意有值的。
// 这样站点只填简中时，英文访客也能看到同一个名字，不会看到空白。

export const FALLBACK_ORDER = ["en", "zh-CN", "zh-TW"];

export function pickLocale(map, current) {
  if (!map || typeof map !== "object") return "";
  for (const key of [current, ...FALLBACK_ORDER]) {
    const value = map[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const first = Object.values(map).find((value) => typeof value === "string" && value.trim());
  return first ? first.trim() : "";
}
