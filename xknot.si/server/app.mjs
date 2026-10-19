// xknot 中枢的接口层。
//
// 只有两类写操作：访客提交加入申请，管理员审核。其余都是读。
// 不设 CORS：只接受同源请求，带 Origin 且与 Host 不一致直接拒绝。
// 静态文件只在本地开发时由这里代管 /admin/，生产交给 nginx。

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkManifestEntry, toManifestEntry } from "./manifest.mjs";
import { applicantReviewMail, newApplicationMail } from "./notify.mjs";
import { ipHash } from "./store.mjs";
import { LIMITS, validateApplication } from "./validate.mjs";

const BODY_LIMIT = 16 * 1024;
const COOKIE = "xknot_admin";

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

function readJson(req) {
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
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
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
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  }
  return req.socket.remoteAddress || "unknown";
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

function cookieHeader(token, { secure, maxAge }) {
  const parts = [`${COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAge}`];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

const ADMIN_ASSETS = {
  "index.html": "text/html; charset=utf-8",
  "admin.js": "text/javascript; charset=utf-8",
  "admin.css": "text/css; charset=utf-8",
};

/**
 * @param {{
 *   store: ReturnType<import("./store.mjs").openStore>,
 *   config: { secret: string, secureCookies?: boolean, trustProxy?: boolean,
 *             sessionDays?: number, adminDir?: string }
 * }} deps
 */
export function createApp({ store, config }) {
  const secret = config.secret || "xknot-dev";
  const secureCookies = Boolean(config.secureCookies);
  const trustProxy = Boolean(config.trustProxy);
  const sessionDays = config.sessionDays || 7;
  const adminDir = config.adminDir;
  const submitLimit = createLimiter({ windowMs: 3600_000, max: 8 });
  const loginLimit = createLimiter({ windowMs: 900_000, max: 12 });
  const noticeLimit = createLimiter({ windowMs: 3600_000, max: 30 });
  const mailer = config.mailer || null;
  const adminEmail = String(config.adminEmail || "").trim();
  const origin = String(config.origin || "https://xknot.si").replace(/\/+$/, "");

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

  function currentAdmin(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const admin = store.sessionAdmin(token);
    return admin ? { ...admin, token } : null;
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

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = url.pathname.replace(/\/+$/, "") || "/";

    if (route.startsWith("/admin")) {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, { error: "method_not_allowed" });
      }
      return serveAdminFile(req, res, route.slice("/admin".length) || "/");
    }

    if (route === "/api/health") {
      return send(res, 200, { ok: true, at: new Date().toISOString() });
    }

    if (!route.startsWith("/api/")) return send(res, 404, { error: "not_found" });

    if (req.method !== "GET" && req.method !== "POST") {
      return send(res, 405, { error: "method_not_allowed" });
    }

    // 同源检查放在最前：跨站表单、跨站脚本都进不来。
    if (req.method === "POST" && !sameOrigin(req)) {
      return send(res, 403, { error: "cross_origin" });
    }

    // ---- 公开：提交申请 ----

    if (route === "/api/applications" && req.method === "POST") {
      const ip = clientIp(req, trustProxy);
      const limit = submitLimit(ipHash(ip, secret));
      if (!limit.allowed) {
        return send(res, 429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
          "retry-after": String(limit.retryAfter),
        });
      }

      const body = await readJson(req);
      if (body.error === "too_large") return send(res, 413, { error: "too_large" });
      if (body.error === "bad_json") return send(res, 400, { error: "bad_json" });

      // 表单里藏了一个正常用户看不见的字段，填了就当机器人，直接回成功。
      if (typeof body.website === "string" && body.website.trim() !== "") {
        return send(res, 201, { application: { id: "XK-DISCARDED", status: "pending" } });
      }

      const checked = validateApplication(body);
      if (!checked.ok) return send(res, 400, { error: "invalid", fields: checked.errors });

      if (store.findOpenByUrl(checked.value.url)) return send(res, 409, { error: "duplicate" });

      const application = store.createApplication({
        ...checked.value,
        locale: typeof body.locale === "string" ? body.locale.slice(0, 12) : null,
        ipHash: ipHash(ip, secret),
      });

      // 全站每小时最多 30 封，防止有人靠刷申请把管理员信箱打爆。
      if (noticeLimit("admin").allowed) {
        notify(() => newApplicationMail(application, { adminEmail, origin }));
      }

      return send(res, 201, {
        application: { id: application.id, status: application.status, createdAt: application.createdAt },
      });
    }

    // ---- 管理：登录 ----

    if (route === "/api/admin/login" && req.method === "POST") {
      const ip = clientIp(req, trustProxy);
      const limit = loginLimit(ipHash(ip, secret));
      if (!limit.allowed) {
        return send(res, 429, { error: "rate_limited", retryAfter: limit.retryAfter }, {
          "retry-after": String(limit.retryAfter),
        });
      }

      const body = await readJson(req);
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

    if (route === "/api/admin/logout" && req.method === "POST") {
      const admin = currentAdmin(req);
      if (admin) store.deleteSession(admin.token);
      return send(res, 200, { ok: true }, { "set-cookie": cookieHeader("", { secure: secureCookies, maxAge: 0 }) });
    }

    if (route === "/api/admin/session" && req.method === "GET") {
      const admin = currentAdmin(req);
      if (!admin) return send(res, 401, { error: "unauthenticated" });
      return send(res, 200, { admin: { username: admin.username } });
    }

    // 以下都要管理员。

    const admin = currentAdmin(req);
    if (!admin) return send(res, 401, { error: "unauthenticated" });

    if (route === "/api/admin/applications" && req.method === "GET") {
      const status = url.searchParams.get("status");
      const wanted = status && status !== "all" ? status : null;
      if (wanted && !["pending", "approved", "rejected", "hold"].includes(wanted)) {
        return send(res, 400, { error: "invalid_status" });
      }
      return send(res, 200, {
        applications: store.listApplications({ status: wanted }),
        counts: store.countsByStatus(),
      });
    }

    const review = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/review$/.exec(route);
    if (review && req.method === "POST") {
      const body = await readJson(req);
      const decision = String(body.decision || "");
      const before = store.getApplication(review[1]);
      const result = store.reviewApplication({
        id: review[1],
        decision: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : decision,
        note: typeof body.note === "string" ? body.note.slice(0, 500) : "",
        admin: admin.username,
      });
      if (result.error === "not_found") return send(res, 404, { error: "not_found" });
      if (result.error === "invalid_decision") return send(res, 400, { error: "invalid_decision" });

      // 只有状态真的变了才寄，重复点同一个审核动作不会重复发信。
      if (before && before.status !== result.application.status) {
        notify(() =>
          applicantReviewMail(result.application, result.application.status, { adminEmail, origin })
        );
      }

      return send(res, 200, { application: result.application });
    }

    const manifest = /^\/api\/admin\/applications\/([A-Za-z0-9-]+)\/manifest$/.exec(route);
    if (manifest && req.method === "GET") {
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

export { LIMITS };
