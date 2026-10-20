import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyEntry, resolve } from "@knot/config";

// 代码目录：源码目录，或发布包里的 <部署根>/releases/<版本>。
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// 只接受能直接放进 <img src> 的地址：http(s)、站内路径、内联图片。
// 这是安全过滤，不是默认值；默认值仍然只在 schema 里写一份。
const SITE_LOGO_PATTERN = /^(https?:\/\/|\/|data:image\/)/i;

function resolved(key, source, ctx) {
  const entry = keyEntry(key);
  if (!entry) throw new Error(`配置键 ${key} 没有在 packages/knot-config 里登记`);
  return resolve(entry, source, ctx);
}

function context(env) {
  return { root: APP_ROOT, deployRoot: APP_ROOT, home: env.HOME || "", expand: true };
}

// 站点身份是双品牌里的个人品牌：名称、介绍、自己的 logo。
// 留空时回落到 schema 里的默认值；长度由界面自己截断，不在这里裁剪。
export function siteBrand(env = process.env) {
  const ctx = context(env);
  const rawLogo = resolved("KNOT_SITE_LOGO", env, ctx);
  return {
    name: resolved("KNOT_SITE_NAME", env, ctx),
    tagline: resolved("KNOT_SITE_TAGLINE", env, ctx),
    logo: SITE_LOGO_PATTERN.test(rawLogo) ? rawLogo : "",
  };
}

// 进程环境 → Backend 的启动配置。
// 默认值不在这里另写：全部从 packages/knot-config/src/schema.mjs 取，
// 站点配置里的键名（KNOT_PORT）和运行时环境里的键名（PORT）的映射也按登记表来。
export function loadBootstrapConfig(env = process.env) {
  const ctx = context(env);
  const pgPort = resolved("KNOT_PGPORT", {}, ctx);
  // 本地 Postgres 用 trust 认证，连接串里不带密码；external 模式由部署脚本写 DATABASE_URL。
  const databaseUrl = String(env.DATABASE_URL || "").trim() || `postgres://knot@127.0.0.1:${pgPort}/knot`;
  const agentEnvDir = String(env.KNOT_AGENT_ENV_DIR || "").trim() || null;
  const brand = siteBrand(env);

  return {
    port: Number(resolved("KNOT_PORT", { KNOT_PORT: env.PORT }, ctx)),
    bindHost: resolved("KNOT_BIND_HOST", { KNOT_BIND_HOST: env.BIND_HOST }, ctx),
    databaseUrl,
    sessionCookieName: resolved("KNOT_SESSION_COOKIE_NAME", { KNOT_SESSION_COOKIE_NAME: env.SESSION_COOKIE_NAME }, ctx),
    publicWebOrigin: resolved("KNOT_PUBLIC_ORIGIN", { KNOT_PUBLIC_ORIGIN: env.PUBLIC_WEB_ORIGIN }, ctx),
    // 静态目录由部署脚本写。没有它就不接管页面，只提供 API。
    staticWebDir: String(env.STATIC_WEB_DIR || "").trim() || null,
    uploadDir: resolved("KNOT_UPLOAD_DIR", { KNOT_UPLOAD_DIR: env.UPLOAD_DIR }, ctx),
    agentEnvDir,
    siteName: brand.name,
    siteTagline: brand.tagline,
  };
}
