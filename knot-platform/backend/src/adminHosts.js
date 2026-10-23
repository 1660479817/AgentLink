import os from "node:os";

// 管理后台的链接要指向实例自己的内网地址，而这个地址只能由实例自己给出：
// 域名那一侧走的是入口 nginx，指不到这里。绑定回环（sites/local）时只有本机可达，
// 绑定通配地址（bot01 的 0.0.0.0）时枚举本机的私有 IPv4。
//
// 规则要和 backend/src/admin.js 的 isIntranetAddress 对齐：链接只能落在它放行的那几段里，
// 否则人点开只会拿到 404。

function octets(address) {
  const parts = String(address || "").trim().split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

export function isPrivateIPv4(address) {
  const nums = octets(address);
  if (!nums) return false;
  const [a, b] = nums;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // 链路本地：仅在没有任何别的地址时才可能用上，排序里排最后。
  return a === 169 && b === 254;
}

export function isLoopbackHost(host) {
  const value = String(host || "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!value || value === "localhost" || value === "::1") return Boolean(value);
  const nums = octets(value);
  return Boolean(nums && nums[0] === 127);
}

function isWildcardHost(host) {
  const value = String(host || "").trim();
  return value === "0.0.0.0" || value === "::" || value === "*" || value === "";
}

// 越常见的家用网段越靠前，人多半就在那一个上面。
function rank(address) {
  const nums = octets(address);
  if (!nums) return 9;
  if (nums[0] === 192 && nums[1] === 168) return 0;
  if (nums[0] === 10) return 1;
  if (nums[0] === 172) return 2;
  return 3;
}

export function listAdminHosts({
  bindHost = "",
  port = 0,
  publicOrigin = "",
  env = process.env,
  interfaces = os.networkInterfaces(),
} = {}) {
  // 拓扑对不上（NAT、多网段、专线）时由运维写死一条，不靠猜。
  const override = String(env.KNOT_ADMIN_ORIGIN || "").trim().replace(/\/+$/, "");
  if (override) return [override];

  const listenPort = Number(port) > 0 ? Number(port) : Number(env.KNOT_PORT) || 8080;
  const bind = String(bindHost || "").trim();

  if (isLoopbackHost(bind)) {
    // 绑在 IPv6 回环上时只能从 [::1] 进；给 127.0.0.1 会连到一个没人听的端口。
    const host = /^\[?::1\]?$/i.test(bind) ? "[::1]" : "127.0.0.1";
    return [`http://${host}:${listenPort}`];
  }
  if (!isWildcardHost(bind)) return [`http://${bind}:${listenPort}`];

  const publicHost = (() => {
    try {
      return new URL(publicOrigin).hostname;
    } catch {
      return "";
    }
  })();

  const found = new Set();
  for (const group of Object.values(interfaces || {})) {
    for (const info of Array.isArray(group) ? group : []) {
      const address = String(info?.address || "");
      if (info?.family && info.family !== "IPv4" && info.family !== 4) continue;
      if (info?.internal) continue;
      if (!isPrivateIPv4(address)) continue;
      if (address === publicHost) continue;
      found.add(address);
    }
  }

  const addresses = [...found].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  if (!addresses.length) return [`http://127.0.0.1:${listenPort}`];
  return addresses.map((address) => `http://${address}:${listenPort}`);
}
