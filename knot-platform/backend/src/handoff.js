import crypto from "node:crypto";

// 管理后台的「从站点过来」入口。
//
// 症结在 origin：WebUI 的会话存在站点域名上（https://<站点>），而 /admin 与 /api/admin
// 只在实例自己的内网地址上（http://127.0.0.1:8081 或 http://192.168.3.91:8080）。
// 两个 origin 不共享 cookie，也不共享 localStorage，所以「域名上已经登录的主理人」
// 换不到「内网这边的管理凭据」。中间放一枚一次性票据，只做这一件事。
//
//   票据   t1.<exp>.<nonce>.<sig>   5 分钟、一次性、只能在内网兑换
//   凭据   kas1.<exp>.<sig>         30 天，只被 /api/admin 认
//
// 两者的签名密钥都从 KNOT_ADMIN_TOKEN 派生，主令牌本身始终不出服务器。
// 换主令牌 = 未兑换的票据与已发出的凭据一起作废，这正是换令牌想要的效果。
//
// 为什么票据不落库：backend/migrations 只有一份基线，加表要整库重建；
// 一次性靠进程内的 nonce 集合就够（5 分钟内重放一次没有实际意义）。
// 代价是重启会丢掉已用记录：一枚未过期、未被兑换的票据在重启后仍能兑换一次。
export const TICKET_TTL_MS = 5 * 60 * 1000;
export const ADMIN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PENDING = 500;

function base64url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(key, payload) {
  return base64url(crypto.createHmac("sha256", key).update(payload).digest());
}

// 比较签名用定长时间，避免按字节猜。长度不同直接假。
function sameSecret(expected, actual) {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(actual || ""));
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// 没有配置令牌时返回一个全部拒绝的实例：调用方不必到处判空。
export function createHandoff({
  token,
  now = Date.now,
  ticketTtlMs = TICKET_TTL_MS,
  adminTtlMs = ADMIN_TTL_MS,
  maxPending = MAX_PENDING,
} = {}) {
  const secret = String(token || "").trim();
  if (!secret) {
    return {
      configured: false,
      ticketTtlMs,
      adminTtlMs,
      issue: () => null,
      claim: () => null,
      verifyAdminSession: () => false,
    };
  }

  const ticketKey = crypto.createHmac("sha256", secret).update("knot-admin-ticket").digest();
  const sessionKey = crypto.createHmac("sha256", secret).update("knot-admin-session").digest();
  // nonce → 票据到期时刻。过了那一刻这枚 nonce 已经没有价值，顺手清掉。
  const spent = new Map();

  function prune(at) {
    for (const [nonce, exp] of spent) if (exp <= at) spent.delete(nonce);
  }

  function issue() {
    const at = now();
    const exp = at + ticketTtlMs;
    const nonce = base64url(crypto.randomBytes(12));
    const payload = `t1.${exp}.${nonce}`;
    return { ticket: `${payload}.${sign(ticketKey, payload)}`, expiresAt: new Date(exp).toISOString() };
  }

  function claim(ticket) {
    const at = now();
    const parts = String(ticket || "").trim().split(".");
    if (parts.length !== 4 || parts[0] !== "t1") return null;
    const exp = Number(parts[1]);
    if (!Number.isSafeInteger(exp) || exp <= at) return null;
    if (!sameSecret(sign(ticketKey, `${parts[0]}.${parts[1]}.${parts[2]}`), parts[3])) return null;
    prune(at);
    if (spent.has(parts[2])) return null;
    spent.set(parts[2], exp);
    // 防一手：同一时刻堆着几百枚未兑换的票据时，丢掉最早的那几枚。
    while (spent.size > maxPending) spent.delete(spent.keys().next().value);
    const sessionExp = at + adminTtlMs;
    const payload = `kas1.${sessionExp}`;
    return {
      credential: `${payload}.${sign(sessionKey, payload)}`,
      expiresAt: new Date(sessionExp).toISOString(),
    };
  }

  function verifyAdminSession(credential) {
    const parts = String(credential || "").trim().split(".");
    if (parts.length !== 3 || parts[0] !== "kas1") return false;
    const exp = Number(parts[1]);
    if (!Number.isSafeInteger(exp) || exp <= now()) return false;
    return sameSecret(sign(sessionKey, `kas1.${parts[1]}`), parts[2]);
  }

  return { configured: true, ticketTtlMs, adminTtlMs, issue, claim, verifyAdminSession };
}
