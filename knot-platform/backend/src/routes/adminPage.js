import express from "express";
import { existsSync } from "node:fs";
import { isLoopbackAddress } from "../admin.js";

// 管理后台只在本机回环地址提供。它不是 /api/admin：这里发的是静态页，
// 页面里再用 Bearer 令牌调 /api/admin。两处各自把关，任何一处漏了都还有另一处。
//
// 页面只用外部 admin.css / admin.js，不写内联脚本和内联样式；
// CSP 因此可以把脚本和样式锁在 'self'，注入的 <script> 不会执行。
export const ADMIN_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export function adminPageGuard(req, res, next) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return res.status(404).type("text/plain; charset=utf-8").send("not_found");
  }
  res.setHeader("Content-Security-Policy", ADMIN_CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

export function adminPageRouter({ dir, exists = existsSync } = {}) {
  const router = express.Router();
  router.use(adminPageGuard);
  if (!dir || !exists(dir)) {
    router.use((_req, res) => res.status(404).type("text/plain; charset=utf-8").send("not_found"));
    return router;
  }
  router.use(
    express.static(dir, {
      index: "index.html",
      etag: true,
      lastModified: true,
      setHeaders(res) {
        // 文件名不带内容哈希，统一不缓存；改完页面刷新就生效。
        res.setHeader("Cache-Control", "no-cache");
      },
    })
  );
  router.use((_req, res) => res.status(404).type("text/plain; charset=utf-8").send("not_found"));
  return router;
}
