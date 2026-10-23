// 列表分隔符按语种拼：中文是顿号「、」，英文是逗号加空格。
// 写死 join("、") 时 en 界面会画出中文标点。
// 用 conjunction + narrow：zh-CN 得 "A、B、C"，en 得 "A, B, C"，
// 没有「和 / and」这种连接词（long / short 会带，不适合权益标签）。
export function listText(items, locale) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  if (list.length === 0) return "";
  try {
    return new Intl.ListFormat(locale, { type: "conjunction", style: "narrow" }).format(list);
  } catch {
    return list.join(", ");
  }
}
