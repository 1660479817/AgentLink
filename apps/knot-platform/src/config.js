function positiveHours(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.round(value));
}

/** 连库、监听，以及悬赏有效期。 */
export function loadBootstrapConfig() {
  const port = Number(process.env.PORT || 8080);
  const bindHost = process.env.BIND_HOST || "0.0.0.0";
  const databaseUrl =
    process.env.DATABASE_URL || "postgres://knot:knot@127.0.0.1:5433/knot";
  const sessionCookieName = process.env.SESSION_COOKIE_NAME || "knot_sid";
  const publicWebOrigin = process.env.PUBLIC_WEB_ORIGIN || "http://127.0.0.1:5173";
  const staticWebDir = process.env.STATIC_WEB_DIR || null;
  const uploadDir = process.env.UPLOAD_DIR || "data/uploads";
  const bountyTtlHours = positiveHours(process.env.BOUNTY_TTL_HOURS, 24);
  return {
    port,
    bindHost,
    databaseUrl,
    sessionCookieName,
    publicWebOrigin,
    staticWebDir,
    uploadDir,
    bountyTtlHours,
  };
}
