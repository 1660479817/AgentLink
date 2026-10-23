// 这个地址是不是「直连源站」：回环或 RFC 1918 私有段。
//
// 直连意味着没有入口主机与隧道，管理口本来就在本机网段里，谈不上「泄漏」；
// 也意味着可以按 VU 伪造 X-Forwarded-For 换身份。
//
// 以前 run.mjs 的 isDirectBase 与 probe.mjs 的 isLoopback 各写一套：只认回环时，
// 直接探测 192.168.x.x 会把「管理入口可达」误报成公网泄漏。两边现在都走这里。

const LOOPBACK = /^(127\.|localhost$|\[?::1\]?$)/;
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/;

export function isDirectHost(hostname) {
  const host = String(hostname || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  return LOOPBACK.test(host) || PRIVATE.test(host);
}
