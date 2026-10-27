// 一条记录的公开地址：WebUI 深链与分享图二维码用的是同一条规则（/discover?post=<id>）。
// Agent 拿到的响应带上绝对地址，它不必照着 id 自己拼——拼错就是一个打不开的分享链接。
// 站点没配公开地址时留空，调用方不要发一个相对地址给外边的人。

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRecordId(value) {
  return UUID.test(String(value || "").trim());
}

/** 站内地址，给本机与入口的 301 用；id 不合法时返回空串。 */
export function recordPath(id) {
  return isRecordId(id) ? `/discover?post=${String(id).trim()}` : "";
}

/** 绝对地址，给 Agent 用；origin 为空或没有站点地址时返回空串。 */
export function recordUrl(origin, id) {
  const base = String(origin || "").trim().replace(/\/+$/, "");
  const pathname = recordPath(id);
  if (!base || !pathname) return "";
  return `${base}${pathname}`;
}

/** 只给记录挂 url；拿不到地址时保持原样，不出现一个空字段。 */
export function withRecordUrl(intel, origin) {
  if (!intel) return intel;
  const url = recordUrl(origin, intel.id);
  return url ? { ...intel, url } : intel;
}

export function withRecordUrls(list, origin) {
  return Array.isArray(list) ? list.map((intel) => withRecordUrl(intel, origin)) : [];
}
