// 首屏兜底的真实浏览器验证。
//
// 单元测试用 fake DOM 覆盖了守卫的逻辑，这里验证三件只有真浏览器能证的事：
//   1. 正常首屏挂载后，<html> 有 data-knot-ready，兜底节点已消失；
//   2. 首屏接口全部失败时，页面不会变成一片空白（要么页面内报错，要么兜底还在）；
//   3. 6 秒兜底计时器不会把正常页面误判成失败。
//
// 默认起一个本地静态服务读构建产物；给 KNOT_BASE（如 https://wang.xknot.si）就直接打
// 那个地址，不碰 dist——这一路才是 bench 的黑箱口径：只输入 URL，不读站点配置。
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const DIST = path.resolve(process.env.KNOT_DIST || "../knot-platform/web/dist");
const PORT = Number(process.env.KNOT_PORT || 4179);

// 与 bench 其它脚本一致：--base 优先，其次 KNOT_BASE；都没有才起本地 dist 服务。
function argValue(name) {
  const index = process.argv.indexOf(name);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1] : "";
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

// 入口的 nginx 对未知路径回落到 index.html；这里照做，SPA 路由才会拿到页面。
let server = null;
let BASE = (argValue("--base") || process.env.KNOT_BASE || "").replace(/\/$/, "");
if (!BASE) {
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    try {
      const stat = await fs.stat(file).catch(() => null);
      if (!stat || stat.isDirectory()) file = path.join(DIST, "index.html");
      const body = await fs.readFile(file);
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  BASE = `http://127.0.0.1:${PORT}`;
}
console.log(`目标：${BASE}\n`);

const browser = await chromium.launch();
const results = [];
function report(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// --- 1. 正常首屏 -------------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const state = await page.evaluate(() => ({
    ready: document.documentElement.hasAttribute("data-knot-ready"),
    boot: Boolean(document.querySelector("[data-knot-boot]")),
    appChildren: document.getElementById("app")?.children.length ?? -1,
    text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60),
  }));

  report("正常首屏：<html data-knot-ready>", state.ready);
  report("正常首屏：兜底节点已被 Vue 替换", !state.boot, `#app 子节点 ${state.appChildren}`);
  report("正常首屏：没有未捕获的脚本错误", errors.length === 0, errors.join(" | ").slice(0, 160));
  report("正常首屏：渲染出了内容", state.text.length > 0, state.text);
  await page.close();
}

// --- 2. 6 秒计时器不误伤 ------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(7000);
  const judged = await page.evaluate(() => {
    const boot = document.querySelector("[data-knot-boot]");
    return { present: Boolean(boot), failed: boot?.classList.contains("is-failed") ?? null };
  });
  report("计时器：7 秒后正常页面没被标成失败", judged.failed !== true, JSON.stringify(judged));
  await page.close();
}

// --- 3. 首屏接口全挂 ---------------------------------------------------------
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // 只掐 /api/web/*，静态资源照常：模拟后端挂了而不是网络全断。
  await page.route("**/api/web/**", (route) => route.abort("failed"));
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const state = await page.evaluate(() => ({
    ready: document.documentElement.hasAttribute("data-knot-ready"),
    boot: Boolean(document.querySelector("[data-knot-boot]")),
    visible: (document.body.innerText || "").trim().length,
    text: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
  }));

  report("接口全挂：页面仍有可见文字（不是白屏）", state.visible > 0, state.text);
  report("接口全挂：脚本没有崩在首屏", state.ready || state.boot, JSON.stringify({ ready: state.ready, boot: state.boot }));
  // 首屏接口失败时的未捕获错误只作为线索打印，不参与判定：页面能显示兜底就算通过。
  if (errors.length) console.log(`      未捕获错误：${errors.join(" | ").slice(0, 200)}`);
  await page.close();
}

await browser.close();
server?.close();

const failed = results.filter((item) => !item.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length === 0 ? 0 : 1);
