// 接口进程入口。
//
// 只监听本机回环地址，由 nginx 反代 /api/ 与 /admin/。
// 环境变量：
//   XKNOT_API_PORT       默认 5181
//   XKNOT_DATA_DIR       默认 <项目>/var
//   XKNOT_SESSION_SECRET 未设置时生成并写入 var/session-secret
//   XKNOT_SECURE_COOKIE  生产置 1，Cookie 加 Secure
//   XKNOT_TRUST_PROXY    生产置 1，取 X-Forwarded-For 的首个地址

import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createApp } from "./app.mjs";
import { openStore } from "./store.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const dataDir = process.env.XKNOT_DATA_DIR || path.join(root, "var");
const port = Number(process.env.XKNOT_API_PORT || 5181);
const host = process.env.XKNOT_API_HOST || "127.0.0.1";

mkdirSync(dataDir, { recursive: true });

function sessionSecret() {
  if (process.env.XKNOT_SESSION_SECRET) return process.env.XKNOT_SESSION_SECRET;
  const file = path.join(dataDir, "session-secret");
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    const secret = randomBytes(32).toString("hex");
    writeFileSync(file, `${secret}\n`, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      // 文件系统不支持时忽略，值已经在内存里了。
    }
    return secret;
  }
}

const store = openStore(path.join(dataDir, "xknot.db"));
const { handle } = createApp({
  store,
  config: {
    secret: sessionSecret(),
    secureCookies: process.env.XKNOT_SECURE_COOKIE === "1",
    trustProxy: process.env.XKNOT_TRUST_PROXY === "1",
    adminDir: path.join(root, "admin"),
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
  console.log(`xknot api on http://${host}:${port}  (db: ${path.join(dataDir, "xknot.db")})`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => {
      store.close();
      process.exit(0);
    });
  });
}
