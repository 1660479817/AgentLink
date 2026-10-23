// 管理后台的入口。地址由 Backend 给（实例自己的内网地址），这里只做三件小事：
// 从候选里挑一个、把票据拼进链接、判断当前页面在不在内网。
//
// 判断网段的规则要和 backend/src/admin.js 的 isIntranetAddress 一致：
// 那边决定放不放行，这边只决定文案的口吻。改一边就要改另一边。

function octets(host) {
  const parts = String(host || "").trim().split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

export function isIntranetHost(hostname) {
  let host = String(hostname || "").trim().toLowerCase();
  if (host.startsWith("[")) host = host.replace(/^\[/, "").replace(/\]$/, "");
  if (!host) return false;
  if (host === "localhost" || host === "::1") return true;

  // IPv6：只认唯一本地（fc00::/7）与链路本地（fe80::/10）。
  if (host.includes(":")) {
    const first = String(host.split(":")[0] || "").trim();
    if (!/^[0-9a-f]{1,4}$/.test(first)) return false;
    // 压缩写法会把 fc00 写成 fc、fd00 写成 fd：右侧补零之后才是真正的前 16 位，
    // 直接 parseInt("fd") 只得 0xfd，与掩码相与为 0，会把内网地址判成公网。
    const head = Number.parseInt(first.padEnd(4, "0"), 16);
    return (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80;
  }

  const nums = octets(host);
  if (!nums) return false;
  const [a, b] = nums;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return a === 169 && b === 254;
}

function cleanOrigin(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s/]+$/.test(text)) return "";
  return text;
}

// 后端按网卡顺序给出候选（常见家用网段在前）。本页如果已经在内网地址上打开，
// 就用同一个 origin，省得再猜；否则用后端排在最前的那个。
export function adminEntryState({ hosts = [], pageOrigin = "" } = {}) {
  const urls = [];
  for (const host of Array.isArray(hosts) ? hosts : []) {
    const origin = cleanOrigin(host);
    if (origin && !urls.includes(origin)) urls.push(origin);
  }
  const current = cleanOrigin(pageOrigin);
  const primary = (current && urls.includes(current) ? current : urls[0]) || "";
  // 一个地址都没有时不假装自己在内网：那只该让界面说「拿不到地址」。
  let hostname = "";
  try {
    hostname = new URL(current || primary).hostname;
  } catch {
    hostname = "";
  }
  return {
    urls,
    primary,
    alternates: urls.filter((url) => url !== primary),
    onIntranet: isIntranetHost(hostname),
  };
}

// 票据放在 # 后面：浏览器不把它发给服务器，nginx 访问日志里也没有。
export function adminUrl(origin, ticket) {
  const base = cleanOrigin(origin);
  if (!base) return "";
  const value = String(ticket || "").trim();
  if (!value) return `${base}/admin/`;
  return `${base}/admin/#t=${encodeURIComponent(value)}`;
}
