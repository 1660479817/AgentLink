// 接口进程入口。
//
// 只监听本机回环地址，由 nginx 反代 /api/ 与 /admin/。
// 环境变量：
//   XKNOT_API_PORT       默认 5181
//   XKNOT_DATA_DIR       默认 <项目>/var
//   XKNOT_SESSION_SECRET 未设置时生成并写入 var/session-secret
//   XKNOT_SECURE_COOKIE  生产置 1，Cookie 加 Secure
//   XKNOT_TRUST_PROXY    生产置 1，取 X-Forwarded-For 的末尾地址（代理追加的真实来源）
//   SMTP_* / MAIL_FROM   发信配置，见 server/mail.mjs；未配置时不发信
//   XKNOT_ADMIN_EMAIL    新申请通知的收件地址
//   XKNOT_PUBLIC_ORIGIN  邮件里的门户地址，默认 https://xknot.si
//   XKNOT_RELAY_ENABLED  委托发信开关，默认随 SMTP 配置；置 0 可单独关掉
//   XKNOT_RELAY_DAILY_LIMIT  每份凭据 24 小时内的发信上限，默认 50
//   XKNOT_MAIL_REPLY_TO  伙伴信的 Reply-To，默认取 MAIL_FROM（不接收回复）
//   XKNOT_SUPPORT_URL    伙伴信里的可选联系入口，留空则整行省略
//   XKNOT_REVIEW_SLA     人工审核时限的展示文案，默认 3 个工作日

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.mjs";
import { createMailer, mailConfigFromEnv } from "./mail.mjs";
import { openStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const dataDir = process.env.XKNOT_DATA_DIR || path.join(root, "var");
const port = Number(process.env.XKNOT_API_PORT || 5181);
const host = process.env.XKNOT_API_HOST || "127.0.0.1";

mkdirSync(dataDir, { recursive: true });

function sessionSecret() {
  const fromEnv = String(process.env.XKNOT_SESSION_SECRET || "").trim();
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir, "session-secret");
  try {
    const existing = readFileSync(file, "utf8").trim();
    // 空文件或半截文件不能退化成固定密钥，重写一份 256 位的。
    if (existing.length >= 32) return existing;
  } catch {
    // 文件不存在，下面生成。
  }
  const secret = randomBytes(32).toString("hex");
  writeFileSync(file, `${secret}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // 文件系统不支持时忽略，值已经在内存里了。
  }
  return secret;
}

const mailConfig = mailConfigFromEnv();
const mailer = createMailer(mailConfig);
const store = openStore(path.join(dataDir, "xknot.db"));

// 发信日志默认留 30 天；启动时先清一次，之后每 6 小时清一次。
function pruneRelayLog() {
  try {
    store.pruneRelayLog(30);
  } catch (error) {
    console.error("relay log prune failed:", error.message);
  }
}
// pending 超过 15 分钟说明进程在发信途中退出，占位要收回，否则会白占额度，
// 同一个幂等键也会一直拿到 pending。SMTP 超时远小于 15 分钟，每分钟查一次足够。
function pruneStaleRelayPending() {
  try {
    store.pruneStaleRelayPending(15);
  } catch (error) {
    console.error("relay pending prune failed:", error.message);
  }
}
pruneRelayLog();
pruneStaleRelayPending();
// 发信日志留 90 天：它只记收件域名和结果，但仍是运营数据，不该无限增长。
function pruneNotifyLog() {
  try {
    store.pruneNotifyLog(90);
  } catch (error) {
    console.error("notify log prune failed:", error.message);
  }
}
pruneNotifyLog();
setInterval(pruneRelayLog, 6 * 3600_000).unref();
setInterval(pruneStaleRelayPending, 60_000).unref();
setInterval(pruneNotifyLog, 24 * 3600_000).unref();

// 委托发信要判断实例是否在册、是否 active，以及回信域名，统一读清单文件。
// 清单会被 `admin-cli publish` 或人工改动，按 mtime/size 缓存，改完立刻生效。
// 本地联调/端到端可以用 XKNOT_INSTANCES_FILE 指向一份测试清单，不动仓库里的实例表。
const instancesFile = process.env.XKNOT_INSTANCES_FILE
  ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
  : path.join(root, "instances.json");

let instancesCache = { key: "", list: [] };
function loadInstances() {
  const file = instancesFile;
  try {
    const stat = statSync(file);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === instancesCache.key) return instancesCache.list;
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    instancesCache = {
      key,
      list: Array.isArray(parsed.instances) ? parsed.instances : [],
    };
    return instancesCache.list;
  } catch (error) {
    console.error("instances.json unreadable:", error.message);
    return instancesCache.list;
  }
}

// 总览要显示上一次探测结果。health.json 由 check-health/watch-health 原子写入，
// 按 mtime/size 缓存，巡检写完下一次请求就能看到，不必重启接口。
const healthFile = path.join(dataDir, "health.json");
let healthCache = { key: "", value: null };
function loadHealth() {
  try {
    const stat = statSync(healthFile);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === healthCache.key) return healthCache.value;
    const parsed = JSON.parse(readFileSync(healthFile, "utf8"));
    healthCache = { key, value: parsed };
    return parsed;
  } catch {
    return healthCache.value;
  }
}

const relayEnabled =
  process.env.XKNOT_RELAY_ENABLED == null
    ? Boolean(mailer)
    : /^(1|true|yes|on)$/i.test(String(process.env.XKNOT_RELAY_ENABLED).trim());

const { handle } = createApp({
  store,
  config: {
    secret: sessionSecret(),
    secureCookies: process.env.XKNOT_SECURE_COOKIE === "1",
    trustProxy: process.env.XKNOT_TRUST_PROXY === "1",
    adminDir: path.join(root, "admin"),
    mailer,
    adminEmail: mailConfig?.adminEmail || "",
    origin: mailConfig?.origin || process.env.XKNOT_PUBLIC_ORIGIN || "https://xknot.si",
    // 对外信一律 no-reply：xknot.si 的 MX 只发信，回信会退。
    replyTo: String(process.env.XKNOT_MAIL_REPLY_TO || mailConfig?.from || "").trim(),
    supportUrl: String(process.env.XKNOT_SUPPORT_URL || "").trim(),
    reviewSla: String(process.env.XKNOT_REVIEW_SLA || "").trim(),
    instancesProvider: loadInstances,
    healthProvider: loadHealth,
    relay: {
      enabled: relayEnabled,
      dailyLimit: Number(process.env.XKNOT_RELAY_DAILY_LIMIT || 50),
    },
  },
});

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("api error:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      res.end('{"error":"server_error"}');
    } else {
      res.end();
    }
  });
});

server.listen(port, host, () => {
  const mail = mailer ? `on (${mailConfig.from})` : "off";
  const relay = relayEnabled && mailer ? "on" : "off";
  console.log(
    `xknot api on http://${host}:${port}  (db: ${path.join(dataDir, "xknot.db")}, mail: ${mail}, relay: ${relay})`
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
