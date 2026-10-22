// 本机入口：把构建好的门户静态站和接口接在同一个源上。
//
// 线上这个角色由 nginx 担任（ops/xknot.si.conf）。本地部署与端到端要验证
// “同源、同样的路径、同样的响应头”，所以这里按那份配置复刻，不依赖 nginx：
//
//   /                    302 /en/
//   /en/ /zh-CN/ /zh-TW/ 目录索引
//   /data/hub.json       构建写出的运行时快照（可用 --data 换成样例）
//   /assets/             带哈希，长缓存
//   /admin, /admin/...   301 补斜杠后反代到接口，头部交给接口自己发
//   /api/...             反代到接口，并补 server 级安全头（与 nginx 一致）
//
// 用法：
//   node ops/local-hub.mjs --dist web/dist --api http://127.0.0.1:5181 --port 5180
//   node ops/local-hub.mjs --dist web/dist --api http://127.0.0.1:5181 --port 0 --data /tmp/hub.json
//
// 只用于本机与内网联调。它不是生产服务器，不做 TLS、不做 gzip。

import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  // 文档页同时发一份原文（如 /knot-help.md）：线上 nginx 用 default_type text/markdown。
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

function applyHeaders(res, headers) {
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) res.setHeader(name, value);
  }
}

/** 路径只能落在 dist 内；`..` 与绝对路径一律拒绝。 */
function resolveInside(base, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const file = path.resolve(base, `.${path.posix.normalize(decoded)}`);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  if (file !== base && !file.startsWith(prefix)) return null;
  return file;
}

async function statFile(file) {
  try {
    const info = await stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

function proxy(req, res, { apiBase, pathname, search, extraHeaders }) {
  const target = new URL(pathname + search, apiBase);
  // 与 nginx 的 `proxy_set_header Host $host` 一致：保留客户端看到的 Host，
  // 接口的同源检查（Origin 对比 Host）才对得上，不能换成上游地址。
  const headers = { ...req.headers, host: req.headers.host || target.host };
  // nginx 用 $proxy_add_x_forwarded_for 追加，不覆盖客户端自己带的那段。
  const remote = req.socket.remoteAddress || "";
  headers["x-forwarded-for"] = req.headers["x-forwarded-for"]
    ? `${req.headers["x-forwarded-for"]}, ${remote}`
    : remote;
  headers["x-real-ip"] = remote;
  headers["x-forwarded-proto"] = "http";
  for (const name of HOP_BY_HOP) delete headers[name];

  const upstream = httpRequest(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: target.pathname + target.search,
      headers,
    },
    (reply) => {
      const out = {};
      for (const [name, value] of Object.entries(reply.headers)) {
        if (!HOP_BY_HOP.has(name) && value !== undefined) out[name] = value;
      }
      // 补在 writeHead 之前；同名头（大小写不敏感）以上游为准，避免发两份。
      for (const [name, value] of Object.entries(extraHeaders || {})) {
        if (!(name.toLowerCase() in out)) out[name] = value;
      }
      res.writeHead(reply.statusCode || 502, out);
      reply.pipe(res);
    }
  );

  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "api_unreachable" }));
  });

  req.pipe(upstream);
}

function notFound(res) {
  applyHeaders(res, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
  res.writeHead(404);
  res.end("not found\n");
}

async function serveStatic(req, res, { distDir, pathname, dataFile }) {
  let relative = pathname;

  if (pathname === "/") {
    applyHeaders(res, SECURITY_HEADERS);
    res.writeHead(302, { location: "/en/" });
    return res.end();
  }

  if (pathname === "/data/hub.json") {
    const file = dataFile || path.join(distDir, "data", "hub.json");
    const info = await statFile(file);
    if (!info) return notFound(res);
    applyHeaders(res, {
      ...SECURITY_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "content-length": String(info.size),
      // 与 nginx 的 `expires -1` 等价：每次都回源校验。
      "cache-control": "no-cache",
    });
    res.writeHead(200);
    if (req.method === "HEAD") return res.end();
    return createReadStream(file).pipe(res);
  }

  // 无扩展名的文档页：/knot-help 取 /knot-help.html（与 nginx 的 try_files 等价）。
  // 只在 .html 真的存在时接管，其余仍走下面的目录规则。
  if (!path.extname(pathname) && pathname !== "/") {
    const page = resolveInside(distDir, `${pathname}.html`);
    if (page && (await statFile(page))) relative = `${pathname}.html`;
  }

  // 目录形式：/en/ 取 /en/index.html；/en 先补斜杠。
  if (relative === pathname && /^\/[A-Za-z-]+\/?$/.test(pathname) && !path.extname(pathname) && pathname !== "/") {
    if (!pathname.endsWith("/")) {
      applyHeaders(res, SECURITY_HEADERS);
      res.writeHead(301, { location: `${pathname}/` });
      return res.end();
    }
    relative = path.posix.join(pathname, "index.html");
  } else if (pathname.endsWith("/")) {
    relative = path.posix.join(pathname, "index.html");
  }

  const file = resolveInside(distDir, relative);
  if (!file) return notFound(res);
  const info = await statFile(file);
  if (!info) return notFound(res);

  const longCache = pathname.startsWith("/assets/");
  applyHeaders(res, {
    ...SECURITY_HEADERS,
    "content-type": contentType(file),
    "content-length": String(info.size),
    "cache-control": longCache ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.writeHead(200);
  if (req.method === "HEAD") return res.end();
  return createReadStream(file).pipe(res);
}

export async function startEntry({
  distDir = path.join(ROOT, "web", "dist"),
  apiBase,
  port = 0,
  host = "127.0.0.1",
  dataFile = null,
} = {}) {
  const dist = path.resolve(distDir);
  const api = String(apiBase || "").replace(/\/+$/, "");
  if (!api) throw new Error("startEntry: apiBase is required");
  // 没有构建产物时每个页面都 404，测试只会看到“某条断言不成立”。
  // 在起服务前说清楚缺什么，省掉一轮排查。
  if (!existsSync(path.join(dist, "index.html"))) {
    throw new Error(`静态站不在 ${dist}：先 npm run build（或 npm run build -- --offline）`);
  }

  function route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const allowed = req.method === "GET" || req.method === "HEAD" || req.method === "POST";
    if (!allowed) {
      applyHeaders(res, SECURITY_HEADERS);
      res.writeHead(405, { allow: "GET, HEAD, POST" });
      return res.end();
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      // /api/ 的 location 没有自己的 add_header，server 级安全头照常补上。
      return proxy(req, res, {
        apiBase: api,
        pathname,
        search: url.search,
        extraHeaders: SECURITY_HEADERS,
      });
    }

    // 伙伴页面：验证、案例、领取。页面自带 CSP 与 no-store，这里只补 noindex；
    // 线上 nginx 对这三条路径关闭 access_log，本地没有访问日志可关。
    if (
      pathname.startsWith("/verify/") ||
      pathname.startsWith("/case/") ||
      pathname.startsWith("/claim/")
    ) {
      return proxy(req, res, {
        apiBase: api,
        pathname,
        search: url.search,
        extraHeaders: { "X-Robots-Tag": "noindex, nofollow" },
      });
    }

    // 与 nginx 的 `location = /admin` 一致：精确匹配先于前缀匹配，补斜杠。
    if (pathname === "/admin") {
      applyHeaders(res, SECURITY_HEADERS);
      res.writeHead(301, { location: "/admin/" });
      return res.end();
    }

    if (pathname.startsWith("/admin/")) {
      // /admin/ 的 location 有自己的 add_header，nginx 不再继承 server 级头；
      // nosniff / CSP / X-Frame-Options 由接口发，这里只补 HSTS 与 noindex。
      return proxy(req, res, {
        apiBase: api,
        pathname,
        search: url.search,
        extraHeaders: {
          "Strict-Transport-Security": SECURITY_HEADERS["Strict-Transport-Security"],
          "X-Robots-Tag": "noindex, nofollow",
        },
      });
    }

    return serveStatic(req, res, { distDir: dist, pathname, dataFile });
  }

  const server = createServer((req, res) => {
    Promise.resolve()
      .then(() => route(req, res))
      .catch((error) => {
        console.error("entry error:", error.message);
        if (!res.headersSent) notFound(res);
        else res.end();
      });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  const actual = server.address().port;
  return {
    server,
    port: actual,
    url: `http://${host}:${actual}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function argValue(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

async function main(argv) {
  const dist = argValue(argv, "--dist", path.join(ROOT, "web", "dist"));
  const api = argValue(argv, "--api", "http://127.0.0.1:5181");
  const port = Number(argValue(argv, "--port", "5180"));
  const host = argValue(argv, "--host", "127.0.0.1");
  const data = argValue(argv, "--data", null);

  const entry = await startEntry({ distDir: dist, apiBase: api, port, host, dataFile: data });
  console.log(`local entry on ${entry.url}  (dist: ${path.resolve(dist)}, api: ${api})`);

  const stop = async () => {
    await entry.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
