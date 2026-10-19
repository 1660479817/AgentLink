const DEFAULT_SESSION_TTL_DAYS = 30;
const DAY_MS = 1000 * 60 * 60 * 24;

// 会话有效期。Cookie 和 sessions.expires_at 用同一个值，改一处就两边都变。
export function sessionTtlMs(env = process.env) {
  const days = Number(env.KNOT_SESSION_TTL_DAYS);
  if (!Number.isFinite(days) || days <= 0) return DEFAULT_SESSION_TTL_DAYS * DAY_MS;
  return Math.round(days * DAY_MS);
}

export function createSessionMiddleware({ pool, sessionCookieName }) {
  return async function session(req, _res, next) {
    req.user = null;
    const sid = req.cookies?.[sessionCookieName];
    if (!sid) return next();
    const { rows } = await pool.query(
      `SELECT user_id FROM sessions WHERE sid = $1 AND expires_at > now()`,
      [sid]
    );
    if (rows[0]) req.user = { id: rows[0].user_id };
    next();
  };
}

export function setSessionCookie(res, sessionCookieName, sid) {
  res.cookie(sessionCookieName, sid, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: sessionTtlMs(),
  });
}

export function clearSessionCookie(res, sessionCookieName) {
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: "lax", path: "/" });
}
