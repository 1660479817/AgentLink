import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoVar = path.resolve(__dirname, "../../..", "var");

/** 仅进程/bootstrap 级：连库与监听，不进 system_config */
export function loadBootstrapConfig() {
  const port = Number(process.env.PORT || 8080);
  const bindHost = process.env.BIND_HOST || "0.0.0.0";
  const databaseUrl =
    process.env.DATABASE_URL || "postgres://knot:knot@127.0.0.1:5433/knot";
  const sessionCookieName = process.env.SESSION_COOKIE_NAME || "knot_sid";
  const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(repoVar, "uploads"));
  const staticWebDir = process.env.STATIC_WEB_DIR
    ? path.resolve(process.env.STATIC_WEB_DIR)
    : null;
  return {
    port,
    bindHost,
    databaseUrl,
    sessionCookieName,
    uploadDir,
    staticWebDir,
  };
}

/** @deprecated use loadBootstrapConfig + loadPlatformSettings */
export function loadConfig() {
  const b = loadBootstrapConfig();
  return {
    ...b,
    publicWebOrigin: process.env.PUBLIC_WEB_ORIGIN || "http://127.0.0.1:5173",
    smtp: {
      host: process.env.SMTP_HOST || "",
      port: Number(process.env.SMTP_PORT || 587),
      secure:
        process.env.SMTP_SECURE === "true"
          ? true
          : process.env.SMTP_SECURE === "false"
            ? false
            : undefined,
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
      from: process.env.SMTP_FROM || "knot@localhost",
    },
  };
}
