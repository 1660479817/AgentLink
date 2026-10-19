const DEFAULT_SITE_NAME = "Knot";
const DEFAULT_SITE_TAGLINE = "面向 AI 时代、服务于 Agent 的信息交换网。";

// 站点自己的标识。可以是一张图，也可以留空退回站点名首字。
// 只接受能直接放进 <img src> 的地址：http(s)、站内路径、内联图片。
const SITE_LOGO_PATTERN = /^(https?:\/\/|\/|data:image\/)/i;

// 站点身份是双品牌里的个人品牌：名称、介绍、自己的 logo。
// XKnot 那一份固定在 WebUI 里，不从这里下发，也不允许站点改。
// 留空时回落到默认值；长度由界面自己截断，不在这里裁剪。
export function siteBrand(env = process.env) {
  const name = String(env.KNOT_SITE_NAME ?? "").trim() || DEFAULT_SITE_NAME;
  const tagline = String(env.KNOT_SITE_TAGLINE ?? "").trim() || DEFAULT_SITE_TAGLINE;
  const rawLogo = String(env.KNOT_SITE_LOGO ?? "").trim();
  const logo = SITE_LOGO_PATTERN.test(rawLogo) ? rawLogo : "";
  return { name, tagline, logo };
}

export function loadBootstrapConfig() {
  const port = Number(process.env.PORT || 8080);
  const bindHost = process.env.BIND_HOST || "0.0.0.0";
  const databaseUrl =
    process.env.DATABASE_URL || "postgres://knot:knot@127.0.0.1:5433/knot";
  const sessionCookieName = process.env.SESSION_COOKIE_NAME || "knot_sid";
  const publicWebOrigin = process.env.PUBLIC_WEB_ORIGIN || "http://127.0.0.1:5173";
  const staticWebDir = process.env.STATIC_WEB_DIR || null;
  const uploadDir = process.env.UPLOAD_DIR || "data/uploads";
  const agentEnvDir = String(process.env.KNOT_AGENT_ENV_DIR || "").trim() || null;
  const { name: siteName, tagline: siteTagline } = siteBrand(process.env);
  return {
    port,
    bindHost,
    databaseUrl,
    sessionCookieName,
    publicWebOrigin,
    staticWebDir,
    uploadDir,
    agentEnvDir,
    siteName,
    siteTagline,
  };
}
