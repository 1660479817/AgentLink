export function loadBootstrapConfig() {
  const port = Number(process.env.PORT || 8080);
  const bindHost = process.env.BIND_HOST || "0.0.0.0";
  const databaseUrl =
    process.env.DATABASE_URL || "postgres://knot:knot@127.0.0.1:5433/knot";
  const sessionCookieName = process.env.SESSION_COOKIE_NAME || "knot_sid";
  const publicWebOrigin = process.env.PUBLIC_WEB_ORIGIN || "http://127.0.0.1:5173";
  const staticWebDir = process.env.STATIC_WEB_DIR || null;
  const uploadDir = process.env.UPLOAD_DIR || "data/uploads";
  return {
    port,
    bindHost,
    databaseUrl,
    sessionCookieName,
    publicWebOrigin,
    staticWebDir,
    uploadDir,
  };
}
