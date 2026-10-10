#!/usr/bin/env node
/**
 * 一次性：把环境变量 SMTP_* / PUBLIC_WEB_ORIGIN 写入 system_config（之后以 DB 为准）
 * Usage: source ops/env/knot-platform.local.env && node scripts/config-import-env.js
 */
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import { savePlatformSettings, redactPlatformForLog } from "../src/system-config.js";

const bootstrap = loadBootstrapConfig();
const client = new pg.Client({ connectionString: bootstrap.databaseUrl });
await client.connect();

const partial = {};
if (process.env.PUBLIC_WEB_ORIGIN) {
  partial.publicWebOrigin = process.env.PUBLIC_WEB_ORIGIN;
}
const smtp = {};
if (process.env.SMTP_HOST) smtp.host = process.env.SMTP_HOST;
if (process.env.SMTP_PORT) smtp.port = Number(process.env.SMTP_PORT);
if (process.env.SMTP_SECURE === "true") smtp.secure = true;
if (process.env.SMTP_SECURE === "false") smtp.secure = false;
if (process.env.SMTP_USER) smtp.user = process.env.SMTP_USER;
if (process.env.SMTP_PASS) smtp.pass = process.env.SMTP_PASS;
if (process.env.SMTP_FROM) smtp.from = process.env.SMTP_FROM;
if (Object.keys(smtp).length) partial.smtp = smtp;

if (!Object.keys(partial).length) {
  console.error("No SMTP_* or PUBLIC_WEB_ORIGIN in environment");
  process.exit(1);
}

const next = await savePlatformSettings(client, partial);
console.log("saved platform config:", JSON.stringify(redactPlatformForLog(next), null, 2));
await client.end();
