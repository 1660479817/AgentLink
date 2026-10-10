import { SESSION_TTL_MS } from "../lib/auth-codes.js";

export function createSessionMiddleware({ pool, sessionCookieName }) {
  return async function session(req, res, next) {
    req.session = null;
    req.user = null;
    const sid = req.cookies?.[sessionCookieName];
    if (!sid) return next();
    const now = Date.now();
    const { rows } = await pool.query(
      `SELECT s.user_id, s.expires_at, u.email, u.status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.sid = $1`,
      [sid]
    );
    const row = rows[0];
    if (!row || Number(row.expires_at) <= now || row.status !== "active") {
      res.clearCookie(sessionCookieName, cookieOpts());
      return next();
    }
    req.session = { sid, userId: row.user_id, expiresAt: Number(row.expires_at) };
    req.user = { id: row.user_id, email: row.email };
    next();
  };
}

export function setSessionCookie(res, sessionCookieName, sid, expiresAt) {
  res.cookie(sessionCookieName, sid, {
    ...cookieOpts(),
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(res, sessionCookieName) {
  res.clearCookie(sessionCookieName, cookieOpts());
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_MS,
  };
}
