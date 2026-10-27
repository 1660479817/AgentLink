import path from "node:path";
import { fileURLToPath } from "node:url";
import { keyEntry, resolve, truthy } from "@knot/config";
import { profileFilePath } from "./profile.js";

// 代码目录：源码目录，或发布包里的 <部署根>/releases/<版本>。
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function resolved(key, source, ctx) {
  const entry = keyEntry(key);
  if (!entry) throw new Error(`配置键 ${key} 没有在 packages/knot-config 里登记`);
  return resolve(entry, source, ctx);
}

function context(env) {
  return { root: APP_ROOT, deployRoot: APP_ROOT, home: env.HOME || "", expand: true };
}

// 进程环境 → Backend 的启动配置。
// 默认值不在这里另写：全部从 packages/knot-config/src/schema.mjs 取，
// 站点配置里的键名（KNOT_PORT）和运行时环境里的键名（PORT）的映射也按登记表来。
//
// 站点身份（名称、介绍、logo、主理人）不在这里：它由主理人在 /admin 里写
// sites/<站点>/profile.json，见 backend/src/profile.js 与 docs/PROFILE.md。
export function loadBootstrapConfig(env = process.env) {
  const ctx = context(env);
  const pgPort = resolved("KNOT_PGPORT", {}, ctx);
  // 本地 Postgres 用 trust 认证，连接串里不带密码；external 模式由部署脚本写 DATABASE_URL。
  const databaseUrl = String(env.DATABASE_URL || "").trim() || `postgres://knot@127.0.0.1:${pgPort}/knot`;
  const agentEnvDir = String(env.KNOT_AGENT_ENV_DIR || "").trim() || null;

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
    // 自述区所在文件；没有部署目录时（单测、本地直跑）为 null，改用内存里的空档案。
    profileFile: profileFilePath(env, agentEnvDir),
    // Knot Store 是一个可关的模块：关掉时页面与网页、Agent 的商店接口一起消失。
    // 必须读运行时 env：空 source 会永远落到 schema 默认值 0，导致 KNOT_STORE_ENABLED=1 无效。
    storeEnabled: truthy(resolved("KNOT_STORE_ENABLED", env, ctx)),
  };
}
