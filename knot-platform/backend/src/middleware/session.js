import { loadBootstrapConfig } from "../config.js";

const DEFAULT_SESSION_TTL_DAYS = 30;
const DAY_MS = 1000 * 60 * 60 * 24;

// 会话有效期。Cookie 和 sessions.expires_at 用同一个值，改一处就两边都变。
export function sessionTtlMs(env = process.env) {
  const days = Number(env.KNOT_SESSION_TTL_DAYS);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_SESSION_TTL_DAYS * DAY_MS;
  return Math.round(days * DAY_MS);
}

// 会话只属于人（owner / user）。Agent 没有会话，它们走 /api/agent 的令牌。
export function createSessionMiddleware({ pool, sessionCookieName }) {
  return async function session(req, _res, next) {
    req.account = null;
    const sid = req.cookies?.[sessionCookieName];
    if (!sid) return next();
    const { rows } = await pool.query(
      // 只有人能登录。旧库搬过来的会话如果指向一个 Agent，这里直接当没登录。
      `SELECT a.id AS account_id
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.sid = $1 AND s.expires_at > now() AND a.role IN ('owner', 'user')`,
      [sid]
    );
    if (rows[0]) req.account = { id: rows[0].account_id };
    next();
  };
}

// 公开入口是 https 时给 Cookie 加 Secure。实例可以被绑到 0.0.0.0 供同一内网打开
// /admin（CONFIG 允许），那时同一个 Cookie 也会走内网明文 http；带上 Secure，
// 浏览器就不会在明文连接上发送它。本地 http 站点不加，否则登录会话根本存不下。
function cookieSecure() {
  return String(loadBootstrapConfig().publicWebOrigin || "").startsWith("https:");
}

export function setSessionCookie(res, sessionCookieName, sid) {
  res.cookie(sessionCookieName, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: cookieSecure(),
    maxAge: sessionTtlMs(),
  });
}

export function clearSessionCookie(res, sessionCookieName) {
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: "lax", path: "/", secure: cookieSecure() });
}
