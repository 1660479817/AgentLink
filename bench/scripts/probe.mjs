import { readFileSync } from "node:fs";
import path from "node:path";
import { connect } from "node:tls";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";

// 黑箱探测：只拿一个 URL，问出这个站点能测什么、跑在什么上。
//
// 不 import 本项目任何东西，不读站点配置，不假设是本机。
// 结果写进每次 run 的 meta，报告里据此说明「这一轮测到了什么、什么没测」——
// 同一个子域两个月后配置变了，表格也能对上。

const UA = "knot-bench/0.2 (+black-box probe)";
const MAX_BODY = 400_000;

// 一个人读页会看的路径。Knot 的 SPA 对任何路径都回 200（前端路由兜底），
// 所以这里只验「回的是不是应用外壳」；某一页到底能不能用，由 human 层真跑一次来定。
export const ROUTES = [
  { path: "/", label: "landing" },
  { path: "/discover", label: "discover" },
  { path: "/wish", label: "wish" },
  { path: "/stars", label: "stars" },
  { path: "/friends", label: "friends" },
  { path: "/notifications", label: "notifications" },
  { path: "/mine", label: "mine" },
  { path: "/mine/submissions", label: "mine-submissions" },
  { path: "/economy", label: "economy" },
];

function hostOf(base) {
  const u = new URL(base);
  const secure = u.protocol === "https:";
  return { hostname: u.hostname, port: Number(u.port || (secure ? 443 : 80)), secure };
}

function timedRequest(url, { headers = {}, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const u = new URL(url);
    const send = u.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(u, { method: "GET", headers: { "user-agent": UA, ...headers }, timeout }, (res) => {
      let text = "";
      let firstByteMs = null;
      let downloaded = 0;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        // 首字节与总耗时是两件事：以前 ttfbMs 在 end 里算，是整页下载完的时间，
        // 却被 compare/summary 标成「TTFB」。大包体的站会看起来「服务端慢」。
        if (firstByteMs == null) firstByteMs = Date.now() - started;
        downloaded += Buffer.byteLength(chunk, "utf8");
        if (text.length < MAX_BODY) text += chunk;
      });
      res.on("end", () => {
        resolve({
          ok: true,
          status: res.statusCode,
          headers: res.headers,
          body: text,
          ttfbMs: firstByteMs ?? Date.now() - started,
          // 字节数用真实收到的量，不用截断后的字符串：超过 MAX_BODY 的页面
          // 以前会报成 400KB，看起来比实际轻。
          bytes: downloaded,
          truncated: downloaded > MAX_BODY,
        });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (error) =>
      resolve({ ok: false, status: 0, headers: {}, body: "", error: String(error.message || error), ttfbMs: Date.now() - started, bytes: 0 })
    );
    req.end();
  });
}

// TLS 单独握手一次：取协议版本、ALPN 与证书剩余天数。
// 证书快过期是「站点会突然全站不可用」的前兆，比任何一个 p95 都重要。
function tlsInfo({ hostname, port, secure }) {
  if (!secure) return Promise.resolve({ protocol: "http", alpn: null, certDaysLeft: null, certIssuer: "" });
  return new Promise((resolve) => {
    const socket = connect(
      { host: hostname, port, servername: hostname, ALPNProtocols: ["h2", "http/1.1"], timeout: 15000 },
      () => {
        const cert = socket.getPeerCertificate() || {};
        const validTo = cert.valid_to ? new Date(cert.valid_to) : null;
        const info = {
          protocol: socket.getProtocol(),
          alpn: socket.alpnProtocol || null,
          certDaysLeft: validTo ? Math.round((validTo - Date.now()) / 86_400_000) : null,
          certIssuer: cert.issuer ? String(cert.issuer.O || cert.issuer.CN || "") : "",
        };
        socket.destroy();
        resolve(info);
      }
    );
    socket.setTimeout(15000, () => {
      socket.destroy();
      resolve({ protocol: null, alpn: null, certDaysLeft: null, certIssuer: "", error: "tls timeout" });
    });
    socket.on("error", (error) => {
      socket.destroy();
      resolve({ protocol: null, alpn: null, certDaysLeft: null, certIssuer: "", error: String(error.message || error) });
    });
  });
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assetPaths(html) {
  const assets = [];
  const re = /["'](\/assets\/[A-Za-z0-9._-]+\.(?:js|css))["']/g;
  let m;
  while ((m = re.exec(html || "")) !== null) if (!assets.includes(m[1])) assets.push(m[1]);
  return assets;
}

function titleOf(html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html || "");
  return m ? m[1].trim().slice(0, 120) : "";
}

export async function probeSite(base, { token = "", routes = ROUTES } = {}) {
  const host = hostOf(base);
  const isLoopback = /^(127\.|localhost$|\[?::1\]?$)/i.test(host.hostname);
  // 内网地址（RFC1918）和回环一样是「直连源站」：没有入口与隧道，管理门本来就在。
  // 以前只认回环，直接探测 192.168.x.x 时会把「管理入口可达」误报成泄漏，
  // 又把直连数字当成公网数字看，和 scripts/run.mjs 的 isDirectBase 口径不一致。
  const isPrivate = isLoopback || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host.hostname);
  const out = {
    base,
    host: host.hostname,
    isLoopback,
    isPrivate,
    isXknotSubdomain: /\.xknot\.si$/i.test(host.hostname),
    probedAt: new Date().toISOString(),
    transport: {},
    instance: null,
    entry: null,
    board: null,
    session: null,
    agent: null,
    leaks: {},
    routes: [],
    capabilities: {},
    warnings: [],
  };

  if (!out.isXknotSubdomain) {
    out.warnings.push(
      isPrivate
        ? `${host.hostname} 是源站直连，不含入口与隧道，数字不能和公网子域比`
        : `${host.hostname} 不是 *.xknot.si 子域，结果不能和联邦内的站点直接比较`
    );
  }

  out.transport = await tlsInfo(host);

  // 首页、健康、快照、会话、两扇管理门一起发。都是 GET，都不改数据。
  const [index, health, boardRes, sessionRes, adminPage, adminApi] = await Promise.all([
    timedRequest(`${base}/`),
    timedRequest(`${base}/api/health`),
    timedRequest(`${base}/discover.json`),
    timedRequest(`${base}/api/web/session`),
    timedRequest(`${base}/admin`),
    timedRequest(`${base}/api/admin/posts`),
  ]);

  // 实例身份：/api/health 是唯一不用登录就能读出部署版本的端点。
  const healthData = parseJson(health.body);
  if (health.ok && healthData && healthData.service === "knot-backend") {
    out.instance = {
      name: healthData.instance || "",
      version: healthData.version || "",
      release: healthData.release || "",
      commit: healthData.commit || "",
      builtAt: healthData.builtAt || "",
    };
  }

  if (index.ok && index.status === 200) {
    out.entry = {
      status: index.status,
      bytes: index.bytes,
      ttfbMs: index.ttfbMs,
      title: titleOf(index.body),
      assets: assetPaths(index.body),
      hasStaticFallback: /<noscript/i.test(index.body),
      isSpaShell: /id=["']app["']/.test(index.body),
      server: index.headers.server || "",
    };
  }

  // 快照是入口主机磁盘上的那一份，条数就是未登录访客首屏能看到的准确数量。
  const boardData = parseJson(boardRes.body);
  if (boardRes.ok && boardRes.status === 200 && boardData && Array.isArray(boardData.information)) {
    const info = boardData.information;
    out.board = {
      posts: info.length,
      withImages: info.filter((i) => Array.isArray(i.images) && i.images.length).length,
      withFiles: info.filter((i) => Array.isArray(i.attachments) && i.attachments.length).length,
      authors: new Set(info.map((i) => i.author?.name || i.author?.id).filter(Boolean)).size,
    };
  }

  const sessionData = parseJson(sessionRes.body);
  if (sessionRes.ok && sessionRes.status === 200 && sessionData) {
    out.session = {
      brand: (sessionData.brand && sessionData.brand.name) || "",
      guestBrowsing: sessionData.site?.guestBrowsing ?? null,
      registrationMode: sessionData.site?.registrationMode ?? null,
    };
  }

  // 授权码给了就问一句它是谁；401 说明码不对，不是站点不支持。
  if (token) {
    const profile = await timedRequest(`${base}/api/agent/profile`, { headers: { authorization: `Bearer ${token}` } });
    const data = parseJson(profile.body);
    if (profile.status === 200 && data?.user) {
      out.agent = {
        displayName: data.user.displayName || "",
        points: data.user.pointsBalance ?? null,
      };
    } else {
      out.warnings.push(`Agent 授权码无效（GET /api/agent/profile → ${profile.status}）`);
    }
  }

  // 管理后台不该出现在公网入口。这一项不通不是「站点有问题」，通了才是。
  // 回环地址是源站直连，管理门本来就在，不算泄漏。
  out.leaks = {
    adminPage: adminPage.status,
    adminApi: adminApi.status,
    ok: adminPage.status >= 400 && adminApi.status >= 400,
  };
  if (!out.leaks.ok && !isPrivate) {
    out.warnings.push(`管理入口可达（/admin=${adminPage.status} /api/admin/posts=${adminApi.status}）`);
  }

  // 路由只验「回的是应用外壳」。到底哪一页能打开，由 human 层真跑一次决定。
  for (const route of routes) {
    const res = await timedRequest(`${base}${route.path}`);
    out.routes.push({
      ...route,
      status: res.status,
      ttfbMs: res.ttfbMs,
      bytes: res.bytes,
      spa: res.ok && res.status === 200 && /id=["']app["']/.test(res.body),
    });
  }

  // 压缩只验主包：入口 nginx 的 gzip_types 里有没有 JS，直接决定首访下载量。
  let encoding = null;
  const js = (out.entry?.assets || []).find((a) => a.endsWith(".js"));
  if (js) {
    const res = await timedRequest(`${base}${js}`, { headers: { "accept-encoding": "gzip, br" } });
    encoding = res.headers["content-encoding"] || "identity";
    out.transport.mainBundle = {
      path: js,
      bytes: res.bytes,
      immutable: /immutable/.test(String(res.headers["cache-control"] || "")),
    };
  }
  out.transport.gzip = encoding === "identity" ? "off" : encoding;

  out.capabilities = {
    webUi: Boolean(out.entry?.isSpaShell && out.entry.assets.length),
    staticEntry: Boolean(out.entry?.hasStaticFallback),
    snapshotBoard: Boolean(out.board),
    webApi: Boolean(out.session),
    agentApi: Boolean(out.agent),
    adminHidden: Boolean(out.leaks.ok),
  };

  if (!out.capabilities.webUi) out.warnings.push("首页不像 Knot WebUI：没有 app 挂载点或 /assets 引用");
  if (!out.capabilities.webApi) out.warnings.push("GET /api/web/session 不是 200，Web API 可能没接上或入口在维护");
  if (!out.capabilities.snapshotBoard) out.warnings.push("GET /discover.json 不可用：首屏会回落隧道，静态层测不到");

  return out;
}

export function summaryLines(target) {
  const tr = target.transport || {};
  const cert = tr.certDaysLeft == null ? "" : ` · 证书剩 ${tr.certDaysLeft} 天`;
  const lines = [`链路   ${tr.protocol || "?"} / ALPN ${tr.alpn || "-"}${cert}`];

  if (target.instance) {
    lines.push(`实例   ${target.instance.name} · ${target.instance.release || target.instance.version} · ${target.instance.commit}`);
  } else {
    lines.push("实例   /api/health 未返回 knot-backend");
  }
  if (target.entry) {
    lines.push(`首页   ${target.entry.bytes}B · ${target.entry.title || "(无标题)"}${target.entry.hasStaticFallback ? " · 含 noscript 兜底" : ""}`);
  }
  if (target.board) {
    lines.push(`快照   ${target.board.posts} 条 · ${target.board.withImages} 张带图 · ${target.board.authors} 位作者`);
  }
  if (target.session) {
    lines.push(`会话   品牌 ${target.session.brand || "-"} · 访客浏览 ${target.session.guestBrowsing} · 注册 ${target.session.registrationMode}`);
  }
  if (target.agent) {
    lines.push(`Agent  ${target.agent.displayName} · 积分 ${target.agent.points}`);
  }

  const caps = Object.entries(target.capabilities || {})
    .map(([k, v]) => `${k}=${v ? "✓" : "✗"}`)
    .join(" · ");
  if (caps) lines.push(`能力   ${caps}`);
  lines.push(`压缩   ${tr.gzip || "?"}${tr.mainBundle ? ` · 主包 ${tr.mainBundle.bytes}B${tr.mainBundle.immutable ? " · immutable" : ""}` : ""}`);
  for (const w of target.warnings || []) lines.push(`注意   ${w}`);
  return lines;
}

// 授权码只从环境变量或 --token-file 读。--token 还留着，但它会进 ps 和 shell
// 历史，和 README 的「不打印、不落盘」相矛盾；新写法优先用文件。
function tokenFromFile(file) {
  try {
    const line = readFileSync(path.resolve(process.cwd(), file), "utf8")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#")) || "";
    return line.replace(/^KNOT_AGENT_TOKEN=/, "").trim().replace(/^["']|["']$/g, "");
  } catch {
    console.error(`读不到授权码文件：${file}`);
    return "";
  }
}

if (process.argv[1] && process.argv[1].endsWith("probe.mjs")) {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const base = String(positional[0] || process.env.BENCH_BASE || "").replace(/\/+$/, "");
  if (!base) {
    console.error("用法：node scripts/probe.mjs https://<标签>.xknot.si [--token-file ~/.knot/agent.env]");
    process.exit(2);
  }
  const fileIndex = process.argv.indexOf("--token-file");
  const tokenIndex = process.argv.indexOf("--token");
  const token = fileIndex > 0
    ? tokenFromFile(String(process.argv[fileIndex + 1] || ""))
    : tokenIndex > 0
      ? String(process.argv[tokenIndex + 1] || "")
      : String(process.env.KNOT_AGENT_TOKEN || "");
  const result = await probeSite(base, { token });
  console.log(summaryLines(result).join("\n"));
  console.log("");
  console.log(JSON.stringify(result, null, 2));
}
