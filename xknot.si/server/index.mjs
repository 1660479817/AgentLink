// 接口进程入口。
//
// 只监听本机回环地址，由 nginx 反代 /api/ 与 /admin/。
// 环境变量：
//   XKNOT_API_PORT       默认 5181
//   XKNOT_DATA_DIR       默认 <项目>/var
//   XKNOT_INSTANCES_FILE 清单路径，默认 <项目>/instances.json
//   XKNOT_FEDERATION_FILE 名册路径，默认 <项目>/federation.json
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

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.mjs";
import { readInstancesCached } from "./instances.mjs";
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
// 发信重试最长 36 分钟，2 小时之后的 pending 一定没人管了；每分钟扫一次够用。
function pruneStaleNotifyPending() {
  try {
    store.pruneStaleNotifyPending(120);
  } catch (error) {
    console.error("notify pending prune failed:", error.message);
  }
}
pruneStaleNotifyPending();
setInterval(pruneRelayLog, 6 * 3600_000).unref();
setInterval(pruneStaleRelayPending, 60_000).unref();
setInterval(pruneStaleNotifyPending, 60_000).unref();
setInterval(pruneNotifyLog, 24 * 3600_000).unref();

// 委托发信要判断实例是否在册、是否 active，以及回信域名，统一读清单文件。
// 清单会被 `admin-cli publish` 或人工改动，按 mtime/size 缓存，改完立刻生效。
// 本地联调/端到端可以用 XKNOT_INSTANCES_FILE 指向一份测试清单，不动仓库里的实例表。
const instancesFile = process.env.XKNOT_INSTANCES_FILE
  ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
  : path.join(root, "instances.json");

let instancesCache = { key: "", list: [] };
function loadInstances() {
  // 解析与 fail-closed 逻辑在 server/instances.mjs，那里能注入 file/cache 单独测。
  const result = readInstancesCached({
    file: instancesFile,
    cache: instancesCache,
    onError: (error) => console.error("instances.json unreadable:", error.message),
  });
  instancesCache = result.cache;
  return result.list;
}

// 总览里点开实例要看到账号配置：身份、接入模式、隧道账号与端口。
// 名册同样按 mtime/size 缓存，改完下次请求就生效。
const federationFile = process.env.XKNOT_FEDERATION_FILE
  ? path.resolve(process.env.XKNOT_FEDERATION_FILE)
  : path.join(root, "federation.json");

let federationCache = { key: "", value: null };
function loadFederation() {
  try {
    const stat = statSync(federationFile);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === federationCache.key) return federationCache.value;
    const parsed = JSON.parse(readFileSync(federationFile, "utf8"));
    federationCache = { key, value: parsed };
    return parsed;
  } catch (error) {
    console.error("federation.json unreadable:", error.message);
    return federationCache.value;
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

// 站点位置由 provision worker 写：隧道对端 IP 的 GeoIP 结论。同样按 mtime 缓存，
// 机器搬了家，下一次采集就能反映到页面上。文件不在就是没有。
const locationsFile = process.env.XKNOT_LOCATIONS_FILE
  ? path.resolve(process.env.XKNOT_LOCATIONS_FILE)
  : path.join(dataDir, "geoip", "locations.json");
let locationsCache = { key: "", value: null };
function loadLocations() {
  try {
    const stat = statSync(locationsFile);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === locationsCache.key) return locationsCache.value;
    const parsed = JSON.parse(readFileSync(locationsFile, "utf8"));
    locationsCache = { key, value: parsed };
    return parsed;
  } catch {
    return locationsCache.value;
  }
}

// 节点状态：ops/node-status.mjs 把健康、隧道、位置、流量合成一份。
// 总览按节点读它，不再分别打开四份文件。文件不在时回落到各自的源。
const statusFile = path.join(dataDir, "status.json");
let statusCache = { key: "", value: null };
function loadStatus() {
  try {
    const stat = statSync(statusFile);
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (key === statusCache.key) return statusCache.value;
    const parsed = JSON.parse(readFileSync(statusFile, "utf8"));
    statusCache = { key, value: parsed };
    return parsed;
  } catch {
    return statusCache.value;
  }
}

// 单个实例近 30 天的入口流量：ops/traffic.mjs 每小时写一份 var/traffic/{id}.json。
// 按文件 mtime/size 缓存，聚合跑完下一次展开就能看到新的一天。id 先过白名单正则，
// 不拿请求里的字符串去拼路径。没有这份文件就是没采集过，不编一份空数据。
const trafficDir = path.join(dataDir, "traffic");
const trafficCache = new Map();
function loadTraffic(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(String(id || ""))) return null;
  const cached = trafficCache.get(id);
  try {
    const stat = statSync(path.join(trafficDir, `${id}.json`));
    const key = `${stat.mtimeMs}:${stat.size}`;
    if (cached && cached.key === key) return cached.value;
    const parsed = JSON.parse(readFileSync(path.join(trafficDir, `${id}.json`), "utf8"));
    trafficCache.set(id, { key, value: parsed });
    return parsed;
  } catch {
    return cached?.value || null;
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
    instancesProvider: loadInstances,
    federationProvider: loadFederation,
    healthProvider: loadHealth,
    locationsProvider: loadLocations,
    statusProvider: loadStatus,
    trafficProvider: loadTraffic,
    // 控制台改配置要写回这两份文件；写之前会整份校验，见 server/edit.mjs。
    instancesFile,
    federationFile,
    // 站点自述的副本目录，由 ops/fetch-profile.mjs 写。控制台只读。
    profilesDir: process.env.XKNOT_PROFILES_DIR
      ? path.resolve(process.env.XKNOT_PROFILES_DIR)
      : path.join(root, "var", "profiles"),
    // 成员入口展示的活动数据与橱窗条数，同样只读构建时取回的副本。
    statsDir: path.join(dataDir, "stats"),
    cardsDir: path.join(dataDir, "cards"),
    locationsFile,
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
