const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

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
    maxAge: SESSION_TTL_MS,
  });
}

export function clearSessionCookie(res, sessionCookieName) {
  res.clearCookie(sessionCookieName, { httpOnly: true, sameSite: "lax", path: "/" });
}

export { SESSION_TTL_MS };
