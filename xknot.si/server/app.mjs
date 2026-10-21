// xknot 中枢的接口层。
//
// 写操作只有六类：访客提交加入申请、确认邮箱、在案例页补材料、一次性领取交付资料、
// 管理员审核、管理员改实例配置。其余都是读。
// 不设 CORS：只接受同源请求，带 Origin 且与 Host 不一致直接拒绝。
// 静态文件只在本地开发时由这里代管 /admin/，生产交给 nginx。

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { updateInstanceConfig } from "./edit.mjs";
import { checkLabel, suggestLabels, SUBDOMAIN_MIN } from "../ops/subdomain.mjs";
import { checkManifestEntry, toManifestEntry } from "./manifest.mjs";
import { memberCodeMail } from "./member-mail.mjs";
import { probeEnabled, probeTargetOf } from "../ops/probe-target.mjs";
import {
  ALL_EVENTS,
  HOLD_ITEM_CODES,
  REJECT_REASON_CODES,
  TEMPLATE_VERSION,
  buildMail,
  normalizeLocale,
} from "./notify.mjs";
import {
  renderCasePage,
  renderClaimPage,
  renderClaimResult,
  renderVerifyPage,
  renderVerifyResult,
} from "./pages.mjs";
import { RELAY_LIMITS, domainOf, relayMessage, validateRelayRequest } from "./relay.mjs";
import { ipHash } from "./store.mjs";
import { LIMITS, validateApplication } from "./validate.mjs";

const BODY_LIMIT = 16 * 1024;
const COOKIE = "xknot_admin";
// 成员会话与管理员会话用两个 Cookie：同一个人可能同时是访客和运营者。
const MEMBER_COOKIE = "xknot_member";
const MEMBER_CODE_TTL = 10; // 分钟
const MEMBER_SESSION_DAYS = 30;

const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    ...HTML_HEADERS,
    "content-length": Buffer.byteLength(html),
  });
  res.end(html);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try {
      out[key] = decodeURIComponent(raw);
    } catch {
      out[key] = raw; // 坏的百分号编码不该让整个请求 500
    }
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        req.destroy();
        resolve({ error: "too_large" });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString("utf8");
      const type = String(req.headers["content-type"] || "").toLowerCase();
      if (type.includes("application/x-www-form-urlencoded")) {
        try {
          const params = new URLSearchParams(raw);
          const out = {};
          for (const [key, value] of params) out[key] = value;
          return resolve(out);
        } catch {
          return resolve({ error: "bad_json" });
        }
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        resolve({ error: "bad_json" });
      }
    });
    req.on("error", () => resolve({ error: "bad_json" }));
  });
}

// 简单的滑动窗口计数：单进程够用，重启后清零。
function createLimiter({ windowMs, max, store = new Map() }) {
  return function hit(key, now = Date.now()) {
    const recent = (store.get(key) || []).filter((at) => now - at < windowMs);
    if (recent.length >= max) {
      store.set(key, recent);
      return { allowed: false, retryAfter: Math.ceil((windowMs - (now - recent[0])) / 1000) };
    }
    recent.push(now);
    store.set(key, recent);
    return { allowed: true };
  };
}

function clientIp(req, trustProxy) {
  const remote = req.socket.remoteAddress || "unknown";
  if (!trustProxy) return remote;

  // nginx 用 $proxy_add_x_forwarded_for 把真实来源追加在末尾。客户端自己
  // 伪造的 X-Forwarded-For 只会出现在前面，取首个地址等于让调用方自选限流桶。
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded !== "string" || !forwarded.trim()) return remote;
  const parts = forwarded.split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  return last && isIP(last) ? last : remote;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl、服务端调用没有 Origin
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// 委托发信走 Bearer，不使用 Cookie：实例是服务端调用，不该带浏览器会话。
function bearerToken(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string") return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

function cookieHeader(token, { secure, maxAge, name = COOKIE }) {
  const parts = [`${name}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

const ADMIN_ASSETS = {
  "index.html": "text/html; charset=utf-8",
  "admin.js": "text/javascript; charset=utf-8",
  "admin.css": "text/css; charset=utf-8",
};

function tokensFrom(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split(/[,，、\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

// 接口自己的版本号，/api/health 与总览用同一个。
const VERSION = "0.2.0";

// 清单里的名称按语种存放；总览是运营视图，优先简体，再英文，最后 id。
function instanceName(instance) {
  const name = instance?.name;
  if (typeof name === "string" && name.trim()) return name;
  if (name && typeof name === "object") {
    return name["zh-CN"] || name.en || name["zh-TW"] || instance?.id || "—";
  }
  return instance?.id || "—";
}

function hostOf(value) {
  try {
    return new URL(String(value)).host.toLowerCase();
  } catch {
    return "";
  }
}

function statSize(file) {
  try {
    return statSync(file).size;
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   store: ReturnType<import("./store.mjs").openStore>,
 *   config: { secret: string, secureCookies?: boolean, trustProxy?: boolean,
 *             sessionDays?: number, adminDir?: string }
 * }} deps
 */
export function createApp({ store, config }) {
  // 生产由 index.mjs 注入；测试或嵌入时没给也不能退化成公开的固定密钥。
  const secret = String(config.secret || "").trim() || randomBytes(32).toString("hex");
  const secureCookies = Boolean(config.secureCookies);
  const trustProxy = Boolean(config.trustProxy);
  const sessionDays = config.sessionDays || 7;
  const adminDir = config.adminDir;
  const submitLimit = createLimiter({ windowMs: 3600_000, max: 8 });
  const loginLimit = createLimiter({ windowMs: 900_000, max: 12 });
  const noticeLimit = createLimiter({ windowMs: 3600_000, max: 30 });
  // 伙伴信按收件地址、收件域名、全站三层限流，避免有人靠刷申请把某个信箱打爆。
  // 上限按「一个真实伙伴走完 收到→验证→补件→通过→签发→交付→上线」留足余量，
  // 同时挡住脚本刷单：单个地址 12 封/24h，单个域名 30 封/24h，全站 200 封/24h。
  const PARTNER_MAIL_LIMITS = { address: 12, domain: 30, global: 200 };
  const partnerAddressLimit = createLimiter({ windowMs: 86400_000, max: PARTNER_MAIL_LIMITS.address });
  const partnerDomainLimit = createLimiter({ windowMs: 86400_000, max: PARTNER_MAIL_LIMITS.domain });
  const partnerGlobalLimit = createLimiter({ windowMs: 86400_000, max: PARTNER_MAIL_LIMITS.global });
  const pageLimit = createLimiter({ windowMs: 900_000, max: 60 });
  // 子域查询是公开接口：给一个按 IP 的宽松上限，够一个人反复敲名字，
  // 又不足以把整个空间枚举一遍。
  const subdomainLimit = createLimiter({ windowMs: 60_000, max: 30 });
  // 登录：一个邮箱 10 分钟最多要 3 枚码，一个 IP 一小时最多 10 次；
  // 换码不等于换 IP，所以 IP 这层挡的是「拿字典刷不同邮箱」。
  const memberCodeLimit = createLimiter({ windowMs: 600_000, max: 3 });
  const memberCodeIpLimit = createLimiter({ windowMs: 3600_000, max: 10 });
  const memberLoginLimit = createLimiter({ windowMs: 900_000, max: 12 });
  const mailer = config.mailer || null;
  const adminEmail = String(config.adminEmail || "").trim();
  const origin = String(config.origin || "https://xknot.si").replace(/\/+$/, "");
  const supportUrl = String(config.supportUrl || "").trim();
  const replyTo = String(config.replyTo || "").trim();
  const reviewSla = String(config.reviewSla || "").trim();
  // 归属验证已随「只按子域走」取消：申请时站点还不存在，子域由中枢签发，
  // 没有需要申请人自证的东西。真正的验收在接通阶段（公网 /api/health）。

  // 委托发信：凭据绑定实例，额度按凭据算，另有进程内的分钟级与全站小时级护栏。
  // 清单可能被 `admin-cli publish` 或人工改动，发信时重新读取，避免暂停/新增要等进程重启。
  const staticInstances = Array.isArray(config.instances) ? config.instances : [];
  const readInstances =
    typeof config.instancesProvider === "function" ? config.instancesProvider : () => staticInstances;
  function findInstance(id) {
    const list = readInstances();
    if (!Array.isArray(list)) return null;
    return list.find((item) => item?.id === id) || null;
  }
  const relayMailer = mailer;
  const relayEnabled = Boolean(config.relay?.enabled) && Boolean(relayMailer);
  const relayDefaultLimit = Math.min(Math.max(Number(config.relay?.dailyLimit) || 50, 1), 5000);
  const relayMinuteLimit = createLimiter({ windowMs: 60_000, max: RELAY_LIMITS.perMinute });
  const relayHourLimit = createLimiter({ windowMs: 3600_000, max: RELAY_LIMITS.perHour });
  const healthProvider = typeof config.healthProvider === "function" ? config.healthProvider : () => null;
  const federationProvider =
    typeof config.federationProvider === "function" ? config.federationProvider : () => null;
  const settings = {
    instancesFile: typeof config.instancesFile === "string" ? config.instancesFile : null,
    federationFile: typeof config.federationFile === "string" ? config.federationFile : null,
    profilesDir: typeof config.profilesDir === "string" ? config.profilesDir : null,
    statsDir: typeof config.statsDir === "string" ? config.statsDir : null,
    cardsDir: typeof config.cardsDir === "string" ? config.cardsDir : null,
  };
  const startedAt = Date.now();

  function readHealth() {
    try {
      const value = healthProvider();
      return value && typeof value === "object" ? value : {};
    } catch {
      return {};
    }
  }

  // 联邦名册只给审核台看：账号身份、接入模式、隧道账号与端口。
  function readFederation() {
    try {
      const value = federationProvider();
      return value && typeof value === "object" ? value : null;
    } catch {
      return null;
    }
  }

  // 站点自述的副本，由 ops/fetch-profile.mjs 写在 var/profiles/{id}.json。
  // 审核台只读它来显示名字；写内容要去实例自己的 /admin。
  function readCachedProfile(id) {
    if (!settings.profilesDir || !id) return null;
    try {
      const payload = JSON.parse(readFileSync(path.join(settings.profilesDir, `${id}.json`), "utf8"));
      return payload && typeof payload === "object" ? payload : null;
    } catch {
      return null;
    }
  }

  function cachedText(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  // 委托发信要用实例的公开联系邮箱做默认回信地址。联系方式属于自述区，
  // 清单里只有签发区，所以取回副本时把它拼进判断用的那份实例上。
  function withSite(instance) {
    const site = readCachedProfile(instance?.id)?.site;
    if (!site || typeof site !== "object") return instance;
    return { ...instance, contact: site.contact || null, name: site.name || null };
  }

  function readCachedJson(dir, id) {
    if (!dir || !id) return null;
    try {
      const payload = JSON.parse(readFileSync(path.join(dir, `${id}.json`), "utf8"));
      return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
    } catch {
      return null;
    }
  }

  // 一个标签只要签发过、或正在审核里，就不能再给别人。
  // 拒绝与撤回的单子释放标签：那两个状态下中枢不会去配 DNS。
  function takenLabels() {
    const taken = new Set();
    for (const instance of Array.isArray(readInstances()) ? readInstances() : []) {
      const host = hostOf(instance?.url);
      if (host.endsWith(".xknot.si")) taken.add(host.slice(0, -".xknot.si".length));
    }
    for (const label of store.takenSubdomains()) taken.add(label);
    return taken;
  }

  function instanceOfApplication(application) {
    const list = Array.isArray(readInstances()) ? readInstances() : [];
    const target = String(application?.url || "").replace(/\/+$/, "");
    if (target) {
      const byUrl = list.find((item) => String(item?.url || "").replace(/\/+$/, "") === target);
      if (byUrl) return byUrl;
    }
    const label = String(application?.subdomain || "").trim();
    if (!label) return null;
    return list.find((item) => hostOf(item?.url) === `${label}.xknot.si`) || null;
  }

  // 成员身份只认审核通过、邮箱已验证的申请单：那是站点对外的正式联系地址。
  // 一个邮箱可能交过几张单（换地址、补服务），取第一张还在册的。
  function memberOf(email) {
    for (const application of store.memberApplications(email)) {
      const instance = instanceOfApplication(application);
      if (instance) return { application, instance };
    }
    return null;
  }

  function normalizeEmail(value) {
    const email = String(value || "").trim().toLowerCase();
    if (email.length > 120) return "";
    return /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email) ? email : "";
  }

  // 登录后看到的东西：本站的公开状态、自报的活动计数与橱窗条数。
  // 全部来自中枢已经取回的副本，不再反向请求实例——门户不能借登录拿一份新的探测权。
  function memberOverview({ email, instanceId }) {
    const instance = findInstance(instanceId);
    if (!instance) return null;
    const site = readCachedProfile(instance.id)?.site || {};
    const health = readHealth();
    const probe =
      health?.instances && typeof health.instances[instance.id] === "object" ? health.instances[instance.id] : null;
    const stats = readCachedJson(settings.statsDir, instance.id);
    const cards = readCachedJson(settings.cardsDir, instance.id);
    const status = instance.status || "active";

    return {
      member: {
        email,
        instanceId: instance.id,
        since: instance.since || null,
        tier: instance.tier || "community",
        status,
      },
      site: {
        name: cachedText(site.name) || instance.id,
        tagline: cachedText(site.tagline) || null,
        intro: cachedText(site.intro) || null,
        logo: cachedText(site.logo) || null,
        url: instance.url || "",
        region: cachedText(site.region) || null,
        timezone: cachedText(site.timezone) || null,
        tags: Array.isArray(site.tags) ? site.tags : [],
      },
      // pending 还没验收，没有任何探测结果可看；suspended / retired 由运营方决定，不展示在线态。
      health: {
        status:
          status === "pending"
            ? "pending"
            : status !== "active"
              ? status
              : probe?.status || "unknown",
        latencyMs: status === "active" ? probe?.latencyMs ?? null : null,
        lastOkAt: status === "active" ? probe?.lastOkAt ?? null : null,
        version: status === "active" ? probe?.version ?? null : null,
        checkedAt: health?.checkedAt ?? null,
      },
      stats: stats
        ? {
            posts: stats.posts || null,
            accounts: stats.accounts || null,
            authors: stats.authors || null,
            fetchedAt: stats.fetchedAt || null,
          }
        : null,
      cards: Array.isArray(cards?.cards) ? cards.cards.length : 0,
      listed: status === "active",
    };
  }

  // 一个实例的运营配置：名册里的账号信息 + 清单里的签发区与拉取入口。  // 名称、介绍、联系方式不在这里：那是主理人的自述区，中枢只存取回的副本。
  function instanceConfig(instance, member) {
    const tunnel = member?.tunnel && typeof member.tunnel === "object" ? member.tunnel : null;
    const cached = readCachedProfile(instance.id);
    return {
      name: cachedText(cached?.site?.name) || instance.id || "",
      tier: instance.tier || "community",
      status: instance.status || "active",
      host: member?.host || hostOf(instance.url) || "",
      account: member?.id || instance.id || "",
      role: member?.role || null,
      standing: member?.standing || null,
      mode: member?.mode || null,
      tunnel: tunnel
        ? { account: tunnel.account || "", port: Number.isInteger(tunnel.port) ? tunnel.port : null }
        : null,
      listed: member ? Boolean(member.listed) : null,
      since: member?.since || instance.since || null,
      note: member?.note || "",
      // 只读：探测地址由 url 推出，不用手填。编辑表单不提供这一项。
      probeUrl: probeTargetOf(instance, member).url,
      // 只读：自述区的取回入口。内容在实例自己的 /admin 里改。
      profileUrl: instance.url ? `${String(instance.url).replace(/\/$/, "")}/api/federation/profile` : "",
      // 自述区最近一次取回的时刻；null 表示还没收到过。
      profileFetchedAt: cached?.fetchedAt || null,
      statsUrl: instance.statsUrl || null,
      cardsUrl: instance.cardsUrl || null,
    };
  }

  // 总览：一次请求把运营最常看的几组数字拼好，页面不再逐个接口取。
  // 只读清单、探测结果、申请库与发信记录，不碰实例自己的数据。
  function buildOverview() {
    const list = Array.isArray(readInstances()) ? readInstances() : [];
    const health = readHealth();
    const checks = health.instances && typeof health.instances === "object" ? health.instances : {};
    const federation = readFederation();
    const members = Array.isArray(federation?.members) ? federation.members : [];
    const memberById = new Map(members.map((member) => [String(member?.id || ""), member]));
    const memberByHost = new Map(
      members
        .map((member) => [String(member?.host || "").toLowerCase(), member])
        .filter(([host]) => host)
    );

    const rows = list.map((instance) => {
      const probe =
        checks[instance.id] && typeof checks[instance.id] === "object" ? checks[instance.id] : null;
      const pending = instance.status === "pending";
      const paused = instance.status !== "active" && !pending;
      const member =
        memberById.get(String(instance.id)) || memberByHost.get(hostOf(instance.url)) || null;
      // 清单里还是 pending 就是「已收录、未验收」，不拿探测结果说话。
      // 名册里没有这个账号（校验本应拦住）也按未接通展示，避免把脱钩当成在线。
      const probed = Boolean(member) && probeEnabled(instance);
      const probeStatus = pending ? "pending" : paused ? "paused" : probed ? probe?.status || "unknown" : "unprobed";
      const cached = readCachedProfile(instance.id);
      return {
        id: instance.id,
        // 名字来自实例自述的副本；还没取回时显示 id。
        name: cachedText(cached?.site?.name) || instanceName(instance),
        url: instance.url || "",
        tier: instance.tier || "community",
        status: instance.status || "active",
        regions: cachedText(cached?.site?.region) ? [cachedText(cached.site.region)] : [],
        profileFetchedAt: cached?.fetchedAt || null,
        services: {
          cards: Boolean(instance.cardsUrl),
          stats: Boolean(instance.statsUrl),
        },
        config: instanceConfig(instance, member),
        health: {
          status: probeStatus,
          latencyMs: probe?.latencyMs ?? null,
          lastOkAt: probe?.lastOkAt || null,
          error: probe?.error || null,
          downSince: probe?.downSince || null,
          hidden: Boolean(probe?.hiddenAt),
        },
      };
    });

    const countBy = (status) => rows.filter((row) => row.health.status === status).length;
    const instances = {
      total: rows.length,
      active: rows.filter((row) => row.status === "active").length,
      pending: rows.filter((row) => row.status === "pending").length,
      paused: rows.filter((row) => row.status !== "active" && row.status !== "pending").length,
      up: countBy("up"),
      degraded: countBy("degraded"),
      down: countBy("down"),
      unknown: countBy("unknown"),
      unprobed: countBy("unprobed"),
      hidden: rows.filter((row) => row.health.hidden).length,
      cards: rows.filter((row) => row.services.cards).length,
      stats: rows.filter((row) => row.services.stats).length,
      checkedAt: health.checkedAt || null,
      rows,
    };

    const counts = store.countsByStatus();
    // 已通过但还没写进清单的申请：审核完最容易漏掉的一步。
    const listedHosts = new Set(rows.map((row) => hostOf(row.url)).filter(Boolean));
    const listedIds = new Set(rows.map((row) => String(row.id)));
    const approvedNotListed = store
      .listApplications({ status: "approved", limit: 500 })
      .filter((application) => {
        const host = hostOf(application.url);
        return !(host && listedHosts.has(host)) && !listedIds.has(String(application.subdomain || ""));
      })
      .map((application) => ({
        id: application.id,
        name: application.name,
        mode: application.mode,
        address: application.url,
      }));

    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const tokens = store.listRelayTokens();

    return {
      at: new Date().toISOString(),
      runtime: {
        version: VERSION,
        uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
        dbBytes: statSize(store.file),
      },
      instances,
      federation: {
        hub: federation?.hub || null,
        updatedAt: federation?.updatedAt || null,
        members: members.length,
      },
      applications: {
        counts,
        total: Object.values(counts).reduce((sum, value) => sum + value, 0),
        oldestOpenAt: store.oldestOpenAt(),
        approvedNotListed,
      },
      mail: {
        enabled: Boolean(mailer),
        relayEnabled,
        windowHours: 24,
        ...store.notifyStats(since),
      },
      relay: {
        enabled: relayEnabled && Boolean(mailer),
        windowHours: 24,
        tokens: tokens.length,
        activeTokens: tokens.filter((token) => !token.revokedAt).length,
        ...store.relayStats(since),
      },
      events: store.events(12),
    };
  }

  // 发信是副作用，不能拖住提交和审核。正文组装和发送都放进 Promise，
  // 任何一步失败只记日志，接口照常返回。
  function notify(build) {
    if (!mailer) return;
    Promise.resolve()
      .then(() => (typeof build === "function" ? build() : build))
      .then((message) => {
        if (!message || !message.to) return;
        return mailer.send(message);
      })
      .catch((error) => {
        console.error("mail failed:", error.message);
      });
  }

  // 发一封伙伴信或内部信：去重 → 限流 → 发送 → 记日志。
  // 状态迁移类事件靠 (event, case_id, state_version) 唯一索引去重；
  // 运营类事件（签发、交付、上线）不传版本号，允许补发。
  function dispatchMail(eventName, application, extra = {}, { dedupeVersion = null } = {}) {
    if (!mailer) return null;
    let message = null;
    try {
      message = buildMail(eventName, application, {
        origin,
        adminEmail,
        supportUrl,
        replyTo,
        ...(reviewSla ? { reviewSla } : {}),
        ...extra,
      });
    } catch (error) {
      console.error("mail build failed:", eventName, error.message);
      return null;
    }
    if (!message || !message.to) return null;

    const recipientDomain = domainOf(message.to);
    const recipientHash = createHash("sha256").update(message.to.toLowerCase()).digest("hex").slice(0, 16);
    const reserved = store.beginNotify({
      event: eventName,
      caseId: application?.id || null,
      stateVersion: dedupeVersion,
      locale: message.locale,
      toDomain: recipientDomain,
      toHash: recipientHash,
      templateVersion: message.templateVersion || TEMPLATE_VERSION,
    });
    if (reserved.duplicate) return { duplicate: true };

    const isPartner = message.audience === "partner";
    if (isPartner) {
      const addressHit = partnerAddressLimit(recipientHash);
      const domainHit = partnerDomainLimit(recipientDomain);
      const globalHit = partnerGlobalLimit("all");
      if (!addressHit.allowed || !domainHit.allowed || !globalHit.allowed) {
        store.finishNotify(reserved.id, { status: "throttled" });
        return { throttled: true };
      }
    }

    Promise.resolve()
      .then(() => mailer.send(message))
      .then(() => store.finishNotify(reserved.id, { status: "sent" }))
      .catch((error) => {
        store.finishNotify(reserved.id, { status: "failed", error: error?.message || "send_failed" });
        console.error("mail failed:", eventName, error.message);
      });

    return { id: reserved.id, message };
  }

  // 提交与验证各配一封伙伴信 + 一封内部信；状态迁移由 review 触发。
  // 案例页的「重新发送」传 dedupe:false：那是显式重发，不该被幂等键挡住。
  function mailApplicationReceived(application, { dedupe = true } = {}) {
    if (!application) return;
    const verify = store.issueVerifyToken({ applicationId: application.id });
    const links = verify?.token ? { verifyUrl: `${origin}/verify/${verify.token}` } : {};
    const version = dedupe ? application.stateVersion : null;
    dispatchMail("partner.received", application, { links }, { dedupeVersion: version });
    // 全站每小时最多 30 封内部告警，防止有人靠刷申请把管理员信箱打爆。
    if (noticeLimit("admin").allowed) {
      dispatchMail("internal.application_new", application, {}, { dedupeVersion: version });
    }
  }

  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const admin = store.sessionAdmin(token);
    return admin ? { ...admin, token } : null;
  }

  function currentMember(req) {
    const token = parseCookies(req.headers.cookie)[MEMBER_COOKIE];
    if (!token) return null;
    const session = store.memberSession(token);
    return session ? { ...session, token } : null;
  }

  async function serveAdminFile(req, res, name) {
    if (!adminDir) return send(res, 404, { error: "not_found" });
    const file = name === "" || name === "/" ? "index.html" : name.replace(/^\//, "");
    const type = ADMIN_ASSETS[file];
    if (!type) return send(res, 404, { error: "not_found" });
    try {
      const body = await readFile(path.join(adminDir, file));
      res.writeHead(200, {
        "content-type": type,
        "content-length": body.length,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin",
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(body);
    } catch {
      send(res, 404, { error: "not_found" });
    }
  }

  // ---- 委托发信：POST 送一封，GET 查额度 ----
  async function handleRelay(req, res) {
    if (!relayEnabled) return send(res, 503, { error: "relay_unavailable" });

    const token = bearerToken(req);
    if (!token) return send(res, 401, { error: "missing_token" });
    const grant = store.verifyRelayToken(token);
    if (grant.error === "revoked") return send(res, 401, { error: "token_revoked" });
    if (!grant.token) return send(res, 401, { error: "invalid_token" });

    const listed = findInstance(grant.token.instanceId);
    if (!listed) return send(res, 403, { error: "instance_not_listed" });
    if (listed.status !== "active") return send(res, 403, { error: "instance_inactive" });
    const instance = withSite(listed);

    const limit = Math.min(grant.token.dailyLimit || relayDefaultLimit, relayDefaultLimit);
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();

    if (req.method === "GET") {
      const used = store.relayUsage(grant.token.id, since);
      return send(res, 200, {
        instance: instance.id,
        token: { label: grant.token.label, dailyLimit: limit },
        quota: { windowHours: 24, used, limit, remaining: Math.max(0, limit - used) },
      });
    }

    const burst = relayMinuteLimit(grant.token.id);
    if (!burst.allowed) {
      return send(res, 429, { error: "rate_limited", retryAfter: burst.retryAfter }, {
        "retry-after": String(burst.retryAfter),
      });
    }
    const hourly = relayHourLimit("all");
    if (!hourly.allowed) {
      return send(res, 429, { error: "rate_limited", scope: "hub", retryAfter: hourly.retryAfter }, {
        "retry-after": String(hourly.retryAfter),
      });
    }

    const body = await readBody(req);
    if (body.error === "too_large") return send(res, 413, { error: "too_large" });
    if (body.error === "bad_json") return send(res, 400, { error: "bad_json" });

    const checked = validateRelayRequest(body, { instance, from: relayMailer.from });
    if (!checked.ok) return send(res, 400, { error: "invalid", fields: checked.errors });
    const value = checked.value;

    const meta = {
      instanceId: instance.id,
      tokenId: grant.token.id,
      toDomain: domainOf(value.to),
      toHash: createHash("sha256").update(value.to.toLowerCase()).digest("hex").slice(0, 16),
      subjectLength: [...value.subject].length,
      idemKey: value.idempotencyKey,
    };

    // 先在同一事务里占额度/占幂等键，再 await 发信。检查和写入之间不能有
    // await，否则并发请求会同时通过额度检查，同一幂等键也会寄两次。
    const reserved = store.reserveRelay({ ...meta, sinceIso: since, limit });

    if (reserved.duplicate) {
      return send(res, 200, {
        ok: true,
        duplicate: true,
        pending: reserved.duplicate.pending || undefined,
        delivery: reserved.duplicate,
      });
    }

    if (reserved.error === "quota_exceeded") {
      return send(
        res,
        429,
        {
          error: "quota_exceeded",
          quota: { windowHours: 24, used: reserved.used, limit: reserved.limit, remaining: 0 },
        },
        { "retry-after": "3600" }
      );
    }

    try {
      await relayMailer.send(relayMessage(value, { instance }));
    } catch (error) {
      store.finishRelay(reserved.id, { status: "failed", error: error.code || error.message });
      console.error("relay failed:", instance.id, error.message);
      return send(res, 502, { error: "smtp_failed" });
    }

    store.finishRelay(reserved.id, { status: "accepted" });
    return send(res, 200, {
      ok: true,
      delivery: { id: reserved.id, at: reserved.at, toDomain: meta.toDomain },
    });
  }

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method;

    // ---- 伙伴页面：只读渲染，不消费令牌 ----

    const verifyPage = /^\/verify\/([A-Za-z0-9_-]{8,128})$/.exec(route);
    if (verifyPage && (method === "GET" || method === "HEAD")) {
      const application = store.verifyTokenApplication(verifyPage[1]);
      return sendHtml(res, 200, renderVerifyPage(verifyPage[1], application?.locale || "en"));
    }

    const casePage = /^\/case\/([A-Za-z0-9_-]{6,64})$/.exec(route);
    if (casePage && (method === "GET" || method === "HEAD")) {
      const application = store.findByCaseKey(casePage[1]);
      const result = {
        resend: url.searchParams.get("resend") === "1" ? "sent" : undefined,
        contact: url.searchParams.get("contact") === "1" ? "confirmed" : undefined,
        publicKey: url.searchParams.get("key") === "1" ? "saved" : undefined,
        withdrawn: url.searchParams.get("withdrawn") === "1" ? 1 : undefined,
      };
      return sendHtml(res, application ? 200 : 404, renderCasePage(application, result));
    }

    const claimPage = /^\/claim\/([A-Za-z0-9_-]{8,128})$/.exec(route);
    if (claimPage && (method === "GET" || method === "HEAD")) {
      return sendHtml(res, 200, renderClaimPage(claimPage[1], null, "zh-CN"));
    }

    if (route.startsWith("/admin")) {
      if (method !== "GET" && method !== "HEAD") {
        return send(res, 405, { error: "method_not_allowed" });
      }
      return serveAdminFile(req, res, route.slice("/admin".length) || "/");
    }

    if (route === "/api/health") {
      return send(res, 200, {
        ok: true,
        service: "xknot-hub",
        version: VERSION,
        at: new Date().toISOString(),
      });
    }

    if (!route.startsWith("/api/")) return send(res, 404, { error: "not_found" });

    if (method !== "GET" && method !== "POST") {
      return send(res, 405, { error: "method_not_allowed" });
    }

    // 同源检查放在最前：跨站表单、跨站脚本都进不来。
    if (method === "POST" && !sameOrigin(req)) {
      return send(res, 403, { error: "cross_origin" });
    }

    // ---- 联邦：实例委托发信（Bearer 鉴权，不看 Cookie）----

    if (route === "/api/federation/mail") return handleRelay(req, res);

    // ---- 公开：一个子域标签能不能签 ----
    //
    // 端侧只展示这个结论。查重把清单与未结案的申请单一起算：审核中的标签
    // 如果显示「可用」，用户会以为还有机会，提交后却被拒。

    if (route === "/api/subdomains/check" && method === "GET") {
      const hit = subdomainLimit(ipHash(clientIp(req, trustProxy), secret));
      if (!hit.allowed) {
        return send(
          res,
          429,
          { error: "rate_limited", retryAfter: hit.retryAfter },
          { "retry-after": String(hit.retryAfter) }
        );
      }
      const input = url.searchParams.get("label") || "";
      const taken = takenLabels();
      const result = checkLabel(input, { taken });
      return send(res, 200, {
        label: result.label,
        available: result.available,
        reason: result.reason,
        min: SUBDOMAIN_MIN,
        suggestions: result.available ? [] : suggestLabels(input, { taken }),
      });
    }

    // ---- 成员入口：邮箱 + 一次性授权码 ----

    if (route === "/api/member/code" && method === "POST") {
      // 没有发信能力时明确说一句：否则用户会一直等一封不会来的信。
      if (!mailer) return send(res, 503, { error: "mail_unavailable" });

      const ip = clientIp(req, trustProxy);
      const ipHit = memberCodeIpLimit(ipHash(ip, secret));
      if (!ipHit.allowed) {
        return send(
          res,
          429,
          { error: "rate_limited", retryAfter: ipHit.retryAfter },
          { "retry-after": String(ipHit.retryAfter) }
        );
      }

      const body = await readBody(req);
      if (body.error === "too_large") return send(res, 413, { error: "too_large" });
      if (body.error === "bad_json") return send(res, 400, { error: "bad_json" });

      const email = normalizeEmail(body.email);
      if (!email) return send(res, 400, { error: "invalid_email" });

      const emailHit = memberCodeLimit(ipHash(`email:${email}`, secret));
      if (!emailHit.allowed) {
        return send(
          res,
          429,
          { error: "rate_limited", retryAfter: emailHit.retryAfter },
          { "retry-after": String(emailHit.retryAfter) }
        );
      }

      // 不是成员也回同一句话：这个接口不能变成「某某邮箱是不是成员」的探测器。
      const match = memberOf(email);
      if (match) {
        const issued = store.issueMemberCode({
          email,
          instanceId: match.instance.id,
          ttlMinutes: MEMBER_CODE_TTL,
        });
        if (!issued.error) {
          const message = memberCodeMail({
            email,
            code: issued.code,
            ttlMinutes: MEMBER_CODE_TTL,
            locale: body.locale || match.application.locale || "zh-CN",
          });
          Promise.resolve()
            .then(() => mailer.send(message))
            .catch((error) => console.error("member code mail failed:", error.message));
        }
      }

      return send(res, 202, { status: "sent", ttlMinutes: MEMBER_CODE_TTL });
    }

    if (route === "/api/member/session" && method === "POST") {
      const ip = clientIp(req, trustProxy);
      const hit = memberLoginLimit(ipHash(ip, secret));
      if (!hit.allowed) {
        return send(
          res,
          429,
          { error: "rate_limited", retryAfter: hit.retryAfter },
          { "retry-after": String(hit.retryAfter) }
        );
      }

      const body = await readBody(req);
      if (body.error === "too_large") return send(res, 413, { error: "too_large" });
      if (body.error === "bad_json") return send(res, 400, { error: "bad_json" });

      const email = normalizeEmail(body.email);
      const code = String(body.code || "").replace(/\s+/g, "");
      if (!email || !/^[0-9]{6}$/.test(code)) return send(res, 400, { error: "invalid_code" });

      const result = store.consumeMemberCode({ email, code });
      if (result.error === "expired") return send(res, 401, { error: "invalid_code", reason: "expired" });
      if (result.error === "too_many_attempts") {
        return send(res, 429, { error: "invalid_code", reason: "too_many_attempts" });
      }
      if (result.error) return send(res, 401, { error: "invalid_code", reason: "mismatch" });

      const overview = memberOverview(result);
      if (!overview) return send(res, 403, { error: "not_member" });

      store.pruneMemberSessions();
      const session = store.createMemberSession({
        email: result.email,
        instanceId: result.instanceId,
        days: MEMBER_SESSION_DAYS,
      });
      return send(
        res,
        200,
        {
          session: { email: result.email, instanceId: result.instanceId, expiresAt: session.expiresAt },
          overview,
        },
        {
          "set-cookie": cookieHeader(session.token, {
            secure: secureCookies,
            maxAge: MEMBER_SESSION_DAYS * 86400,
            name: MEMBER_COOKIE,
          }),
        }
      );
    }

    if (route === "/api/member/session" && method === "GET") {
      const member = currentMember(req);
      if (!member) return send(res, 401, { error: "unauthenticated" });
      const overview = memberOverview(member);
      if (!overview) {
        // 站点被移出名册后，旧会话不该继续显示一份冻结的数据。
        store.deleteMemberSession(member.token);
        return send(res, 401, { error: "unauthenticated" });
      }
      return send(res, 200, {
        session: { email: member.email, instanceId: member.instanceId, expiresAt: member.expiresAt },
        overview,
      });
    }

    if (route === "/api/member/logout" && method === "POST") {
      const member = currentMember(req);
      if (member) store.deleteMemberSession(member.token);
      return send(
        res,
        200,
        { ok: true },
        {
          "set-cookie": cookieHeader("", {
            secure: secureCookies,
            maxAge: 0,
            name: MEMBER_COOKIE,
          }),
        }
      );
    }

    // ---- 伙伴：确认邮箱（GET 只给页面，POST 才消费）----

    if (route === "/api/verify" && method === "POST") {
      const body = await readBody(req);
      if (body.error === "too_large") return sendHtml(res, 413, renderVerifyResult("missing", null, "zh-CN"));
      const limited = pageLimit(ipHash(clientIp(req, trustProxy), secret));
      if (!limited.allowed) return sendHtml(res, 429, renderVerifyResult("missing", null, "zh-CN"));

      const result = store.consumeVerifyToken(body.token);
      if (result.error === "not_found") return sendHtml(res, 404, renderVerifyResult("missing", null, "zh-CN"));
      if (result.error === "already_used") {
        const application = store.verifyTokenApplication(body.token);
        return sendHtml(res, 200, renderVerifyResult("used", application, "zh-CN"));
      }
      if (result.error === "expired") return sendHtml(res, 410, renderVerifyResult("expired", result.application, "zh-CN"));
      if (result.error === "closed") return sendHtml(res, 409, renderVerifyResult("closed", result.application, "zh-CN"));

      const application = result.application;
      if (result.transitioned) {
        dispatchMail("partner.verified", application, {}, { dedupeVersion: application.stateVersion });
        dispatchMail("internal.application_verified", application, {}, { dedupeVersion: application.stateVersion });
      }
      return sendHtml(res, 200, renderVerifyResult(result.transitioned ? "ok" : "already", application, "zh-CN"));
    }

    // ---- 伙伴：案例页上的动作 ----

    const caseAction = /^\/api\/case\/([A-Za-z0-9_-]{6,64})\/(resend-verify|withdraw|public-key|confirm-contact)$/.exec(
      route
    );
    if (caseAction && method === "POST") {
      const [, key, action] = caseAction;
      const application = store.findByCaseKey(key);
      if (!application) return sendHtml(res, 404, renderCasePage(null));
      const limited = pageLimit(ipHash(`${clientIp(req, trustProxy)}|${key}`, secret));
      if (!limited.allowed) return sendHtml(res, 429, renderCasePage(application));

      if (action === "withdraw") {
        const result = store.withdrawApplication(application.id);
        if (result.error) return sendHtml(res, 409, renderCasePage(application));
        res.writeHead(303, { location: `/case/${key}?withdrawn=1`, "cache-control": "no-store" });
        return res.end();
      }

      if (action === "resend-verify") {
        if (application.status !== "pending") {
          res.writeHead(303, { location: `/case/${key}`, "cache-control": "no-store" });
          return res.end();
        }
        // 补发不做状态去重：这是一次显式的重发请求。
        mailApplicationReceived(application, { dedupe: false });
        res.writeHead(303, { location: `/case/${key}?resend=1`, "cache-control": "no-store" });
        return res.end();
      }

      if (action === "public-key") {
        const body = await readBody(req);
        const text = String(body.publicKey || "").trim();
        if (!/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-[a-z0-9-]+)\s+[A-Za-z0-9+/=]+(\s+.*)?$/.test(text) || text.length > 1000) {
          res.writeHead(303, { location: `/case/${key}`, "cache-control": "no-store" });
          return res.end();
        }
        store.setPublicKey({ id: application.id, publicKey: text });
        res.writeHead(303, { location: `/case/${key}?key=1`, "cache-control": "no-store" });
        return res.end();
      }

      if (action === "confirm-contact") {
        store.markContactVerified(application.id);
        res.writeHead(303, { location: `/case/${key}?contact=1`, "cache-control": "no-store" });
        return res.end();
      }
    }

    // ---- 伙伴：一次性领取 ----

    if (route === "/api/claim" && method === "POST") {
      const body = await readBody(req);
      const limited = pageLimit(ipHash(clientIp(req, trustProxy), secret));
      if (!limited.allowed) return sendHtml(res, 429, renderClaimResult("missing", null, "zh-CN"));
      const result = store.consumeClaimToken(body.token);
      if (result.error === "missing") return sendHtml(res, 404, renderClaimResult("missing", null, "zh-CN"));
      if (result.error === "not_found") return sendHtml(res, 404, renderClaimResult("missing", null, "zh-CN"));
      if (result.error === "expired") return sendHtml(res, 410, renderClaimResult("expired", null, "zh-CN"));
      if (result.error === "already_used") return sendHtml(res, 409, renderClaimResult("used", null, "zh-CN"));
      return sendHtml(res, 200, renderClaimResult("ok", result.payload, "zh-CN"));
    }

    // ---- 公开：提交申请 ----

    if (route === "/api/applications" && method === "POST") {
      const ip = clientIp(req, trustProxy);
      const limit = submitLimit(ipHash(ip, secret));
      if (!limit.allowed) {
        return send(res, 429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
          "retry-after": String(limit.retryAfter),
        });
      }

      const body = await readBody(req);
      if (body.error === "too_large") return send(res, 413, { error: "too_large" });
      if (body.error === "bad_json") return send(res, 400, { error: "bad_json" });

      // 表单里藏了一个正常用户看不见的字段，填了就当机器人，直接回成功。
      if (typeof body.website === "string" && body.website.trim() !== "") {
        return send(res, 201, { application: { id: "XK-DISCARDED", status: "pending" } });
      }

      const checked = validateApplication(body);
      if (!checked.ok) return send(res, 400, { error: "invalid", fields: checked.errors });

      // 两种模式各自按地址查重：未结案时同一个地址只能有一条申请。
      const duplicate =
        checked.value.mode === "own-domain"
          ? store.findOpenByDomain(checked.value.domain)
          : store.findOpenBySubdomain(checked.value.subdomain);
      if (duplicate) return send(res, 409, { error: "duplicate" });

      const services = tokensFrom(body.services).filter((item) =>
        ["relay", "cards", "stats"].includes(item)
      );
      const application = store.createApplication({
        ...checked.value,
        locale: typeof body.locale === "string" ? body.locale.slice(0, 12) : null,
        ipHash: ipHash(ip, secret),
        requestServices: services,
      });

      // 伙伴回执带验证链接；没有 SMTP 时只是入队，管理员仍能在审核台看到。
      mailApplicationReceived(application);

      return send(res, 201, {
        application: {
          id: application.id,
          status: application.status,
          createdAt: application.createdAt,
          caseUrl: application.caseKey ? `${origin}/case/${application.caseKey}` : undefined,
        },
      });
    }

    // ---- 管理：登录 ----

    if (route === "/api/admin/login" && method === "POST") {
      const ip = clientIp(req, trustProxy);
      const limit = loginLimit(ipHash(ip, secret));
      if (!limit.allowed) {
        return send(res, 429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
          "retry-after": String(limit.retryAfter),
        });
      }

      const body = await readBody(req);
      if (typeof body.username !== "string" || typeof body.password !== "string") {
        return send(res, 400, { error: "invalid" });
      }
      const usernameKey = createHash("sha256").update(body.username.toLowerCase()).digest("hex");
      if (!loginLimit(`user:${usernameKey}`).allowed) {
        return send(res, 429, { error: "rate_limited", retryAfter: 900 });
      }

      const admin = store.verifyAdmin({ username: body.username, password: body.password });
      if (!admin) return send(res, 401, { error: "bad_credentials" });

      store.pruneSessions();
      const session = store.createSession(admin.id, sessionDays);
      return send(
        res,
        200,
        { admin: { username: admin.username } },
        {
          "set-cookie": cookieHeader(session.token, { secure: secureCookies, maxAge: sessionDays * 86400 }),
        }
      );
    }

    if (route === "/api/admin/logout" && method === "POST") {
      const admin = currentAdmin(req);
      if (admin) store.deleteSession(admin.token);
      return send(res, 200, { ok: true }, { "set-cookie": cookieHeader("", { secure: secureCookies, maxAge: 0 }) });
    }

    if (route === "/api/admin/session" && method === "GET") {
      const admin = currentAdmin(req);
      if (!admin) return send(res, 401, { error: "unauthenticated" });
      return send(res, 200, { admin: { username: admin.username } });
    }

    // 以下都要管理员。

    const admin = currentAdmin(req);
    if (!admin) return send(res, 401, { error: "unauthenticated" });

    // 审核台首页用的汇总：实例与探测、申请队列、发信与最近事件。
    if (route === "/api/admin/overview" && method === "GET") {
      return send(res, 200, buildOverview());
    }

    // 改实例配置：清单字段与名册字段一起提交，先校验整份文件再原子写回。
    const instanceConfig = /^\/api\/admin\/instances\/([a-z0-9][a-z0-9-]{0,30}[a-z0-9])\/config$/.exec(route);
    if (instanceConfig && method === "POST") {
      const body = await readBody(req);
      if (body.error === "too_large") return send(res, 413, { error: "too_large" });
      if (body.error) return send(res, 400, { error: "bad_json" });

      const result = await updateInstanceConfig({
        instancesFile: settings.instancesFile,
        federationFile: settings.federationFile,
        id: instanceConfig[1],
        instance: body.instance,
        member: body.member,
      });
      if (result.error === "editing_unavailable") {
        return send(res, 503, { error: "editing_unavailable" });
      }
      if (result.error === "manifest_unreadable" || result.error === "roster_unreadable") {
        return send(res, 500, { error: result.error });
      }
      if (result.error === "not_found") return send(res, 404, { error: "not_found" });
      if (result.error === "invalid") return send(res, 400, { error: "invalid", fields: result.fields });

      store.recordEvent("instance.updated", instanceConfig[1], admin.username);
      return send(res, 200, { ok: true });
    }

    if (route === "/api/admin/applications" && method === "GET") {
      const status = url.searchParams.get("status");
      const wanted = status && status !== "all" ? status : null;
      if (wanted && !["pending", "verified", "approved", "rejected", "hold", "withdrawn", "expired"].includes(wanted)) {
        return send(res, 400, { error: "invalid_status" });
      }
      return send(res, 200, {
        applications: store.listApplications({ status: wanted }),
        counts: store.countsByStatus(),
      });
    }

    const adminCase = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)$/.exec(route);
    if (adminCase && method === "GET") {
      const application = store.getApplication(adminCase[1]);
      if (!application) return send(res, 404, { error: "not_found" });
      return send(res, 200, { application });
    }

    if (route === "/api/admin/notify-log" && method === "GET") {
      const limit = Number(url.searchParams.get("limit")) || 50;
      return send(res, 200, { entries: store.listNotifyLog(limit, url.searchParams.get("case") || null) });
    }

    // 邮箱验证信寄不到时的人工确认。接口与 `admin-cli verify` 走同一条迁移。
    const manualVerify = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/verify$/.exec(route);
    if (manualVerify && method === "POST") {
      const application = store.getApplication(manualVerify[1]);
      if (!application) return send(res, 404, { error: "not_found" });
      const result = store.markEmailVerified(application.id);
      if (result.error === "invalid_transition") {
        return send(res, 409, { error: "invalid_transition", from: application.status, to: "verified" });
      }
      const verified = result.application;
      dispatchMail("partner.verified", verified, {}, { dedupeVersion: verified.stateVersion });
      dispatchMail("internal.application_verified", verified, {}, { dedupeVersion: verified.stateVersion });
      return send(res, 200, { application: verified });
    }

    const review = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/review$/.exec(route);
    if (review && method === "POST") {
      const body = await readBody(req);
      const decision = String(body.decision || "");
      const before = store.getApplication(review[1]);
      if (!before) return send(res, 404, { error: "not_found" });

      const items = tokensFrom(body.items).filter((code) => HOLD_ITEM_CODES.includes(code));
      const reason = REJECT_REASON_CODES.includes(body.reason) ? body.reason : "incomplete";
      const result = store.reviewApplication({
        id: review[1],
        decision,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : "",
        items,
        reason,
        admin: admin.username,
      });
      if (result.error === "not_found") return send(res, 404, { error: "not_found" });
      if (result.error === "invalid_decision") return send(res, 400, { error: "invalid_decision" });
      if (result.error === "invalid_transition") {
        return send(res, 409, { error: "invalid_transition", from: result.from, to: result.to });
      }

      const application = result.application;
      // 只有状态真的变了才寄；幂等键含版本号，重复点同一个动作不会重复发信。
      const event = {
        approved: "partner.approved",
        rejected: "partner.rejected",
        hold: "partner.hold",
      }[application.status];
      if (event) {
        dispatchMail(event, application, {}, { dedupeVersion: application.stateVersion });
      }

      return send(res, 200, { application });
    }

    const notifyRoute = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/notify$/.exec(route);
    if (notifyRoute && method === "POST") {
      const body = await readBody(req);
      const application = store.getApplication(notifyRoute[1]);
      if (!application) return send(res, 404, { error: "not_found" });
      const event = String(body.event || "");
      if (!ALL_EVENTS.includes(event)) return send(res, 400, { error: "unknown_event" });

      const links = {};
      let verifyToken = null;
      if (event === "partner.received") {
        const issued = store.issueVerifyToken({ applicationId: application.id });
        verifyToken = issued.token;
        links.verifyUrl = `${origin}/verify/${issued.token}`;
      }
      const result = dispatchMail(event, application, { ...body.context, links }, {});
      if (!result) return send(res, 503, { error: "mail_unavailable" });
      if (result.duplicate) return send(res, 200, { ok: true, duplicate: true });
      if (result.throttled) return send(res, 429, { error: "throttled" });
      return send(res, 200, {
        ok: true,
        event,
        verifyUrl: links.verifyUrl || undefined,
        to: result.message?.to,
      });
    }

    // 交付：把接入资料写进一次性领取令牌，再把链接寄给主理人。
    const handoff = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/handoff$/.exec(route);
    if (handoff && method === "POST") {
      const body = await readBody(req);
      const application = store.getApplication(handoff[1]);
      if (!application) return send(res, 404, { error: "not_found" });
      if (application.status !== "approved") return send(res, 409, { error: "not_approved" });

      const payload = String(body.payload || "").trim();
      if (!payload) return send(res, 400, { error: "invalid", fields: { payload: "required" } });
      if (payload.length > 8000) return send(res, 413, { error: "too_large" });

      const claim = store.createClaimToken({
        applicationId: application.id,
        payload,
        ttlHours: Math.min(Math.max(Number(body.ttlHours) || 72, 1), 168),
        createdBy: admin.username,
      });
      if (claim.error) return send(res, 400, { error: claim.error });

      const links = { claimUrl: `${origin}/claim/${claim.token}` };
      const result = dispatchMail("partner.handoff", application, { ...body.context, links }, {});
      if (!result) return send(res, 503, { error: "mail_unavailable" });
      if (result.throttled) return send(res, 429, { error: "throttled" });

      return send(res, 200, {
        ok: true,
        claim: { id: claim.id, expiresAt: claim.expiresAt },
        claimUrl: links.claimUrl,
      });
    }

    const manifest = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/manifest$/.exec(route);
    if (manifest && method === "GET") {
      const application = store.getApplication(manifest[1]);
      if (!application) return send(res, 404, { error: "not_found" });
      const entry = toManifestEntry(application);
      const problems = checkManifestEntry(entry);
      if (problems.length) return send(res, 422, { error: "manifest_invalid", problems });
      return send(res, 200, { entry });
    }

    return send(res, 404, { error: "not_found" });
  }

  return { handle, COOKIE, ipHash: (ip) => ipHash(ip, secret) };
}

export function adminDirOf(here) {
  return path.join(path.dirname(fileURLToPath(here)), "..", "admin");
}

export { LIMITS, normalizeLocale };
