#!/usr/bin/env node
// 新用户第一次打开：一个空缓存、空 localStorage 的浏览器上下文，从导航到信息流出现的全过程。
//
// 与 visitor.mjs 的分工：
//   visitor.mjs  每个页面量 TTFB / DCL / LCP / 传输量，回答「单页多快」
//   first-open   只量第一次打开，回答「新用户等多久才看到内容」，并把字节按静态/接口/图片拆开
//
// 黑箱：只给一个 URL，不读站点配置，不 import 两个项目的代码。
// 用法：
//   node human/first-open.mjs --base https://wang.xknot.si
//   node human/first-open.mjs --base https://wang.xknot.si --throttle 4g --ua wechat
//   node human/first-open.mjs --base https://wang.xknot.si --no-js     # JS 被拦掉时还剩什么
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const arg = (name, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    console.error(`--${name} 需要一个值`);
    process.exit(2);
  }
  return value;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = arg("base");
if (!BASE) {
  console.error("缺少 --base，例如 --base https://wang.xknot.si");
  process.exit(2);
}
const RUNS = Math.max(1, Number(arg("runs", "3")) || 3);
const THROTTLE = arg("throttle", "none");
const UA_KIND = arg("ua", "mobile");
const COOKIE_FILE = arg("cookie-file", "");
const OUT = arg("out", "");

// 4G / 慢速 3G 的取值与 Chrome DevTools 的预设一致：延迟是单程，不是 RTT。
const PROFILES = {
  none: null,
  "4g": { latency: 70, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
  slow3g: { latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
};
if (!(THROTTLE in PROFILES)) {
  console.error(`--throttle 只能是 ${Object.keys(PROFILES).join(" / ")}`);
  process.exit(2);
}

const UAS = {
  mobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  wechat:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN",
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};
const ua = UAS[UA_KIND] || UA_KIND;

const COOKIE = (() => {
  if (!COOKIE_FILE) return null;
  const raw = fs.readFileSync(COOKIE_FILE, "utf8").split("\n").map((s) => s.trim()).find(Boolean) || "";
  const eq = raw.indexOf("=");
  if (eq < 1) return null;
  return { name: raw.slice(0, eq), value: raw.slice(eq + 1) };
})();

const LCP_INIT = `
window.__lcp = 0;
try {
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__lcp = Math.round(entry.startTime);
  }).observe({ type: "largest-contentful-paint", buffered: true });
} catch {}
`;

const round = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const kb = (bytes) => Math.round((Number(bytes) || 0) / 1024);

function classify(url) {
  const u = new URL(url);
  if (u.pathname.startsWith("/api/")) return "api";
  if (/\.(js|css|mjs)$/.test(u.pathname)) return "code";
  if (/\.(png|jpe?g|webp|avif|gif|svg)$/.test(u.pathname) || u.pathname.includes("/uploads/")) return "image";
  return "other";
}

async function measureOnce(browser, index) {
  const context = await browser.newContext({
    viewport: UA_KIND === "desktop" ? { width: 1440, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: UA_KIND === "desktop" ? 1 : 3,
    isMobile: UA_KIND !== "desktop",
    hasTouch: UA_KIND !== "desktop",
    userAgent: ua,
    locale: "zh-CN",
  });
  if (COOKIE) {
    await context.addCookies([
      { ...COOKIE, domain: new URL(BASE).hostname, path: "/", httpOnly: true, secure: BASE.startsWith("https:") },
    ]);
  }
  await context.addInitScript(LCP_INIT);

  if (flag("no-js")) {
    await context.route("**/assets/*.js", (route) => route.abort());
  }

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  if (PROFILES[THROTTLE]) {
    await cdp.send("Network.emulateNetworkConditions", { offline: false, ...PROFILES[THROTTLE] });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  const requests = new Map();
  cdp.on("Network.responseReceived", (event) => {
    requests.set(event.requestId, {
      url: event.response.url,
      type: event.type,
      status: event.response.status,
      mime: event.response.mimeType,
      fromCache: event.response.fromDiskCache || event.response.fromMemoryCache,
    });
  });
  cdp.on("Network.loadingFinished", (event) => {
    const row = requests.get(event.requestId);
    if (row) row.bytes = event.encodedDataLength;
  });
  const failures = [];
  page.on("requestfailed", (req) => failures.push(`${req.method()} ${req.url()} ${req.failure()?.errorText || ""}`));
  const consoleErrors = [];
  page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text().slice(0, 200)));

  const started = Date.now();
  await page.goto(BASE, { waitUntil: "commit", timeout: 60000 });
  const commit = Date.now() - started;

  let mounted = null;
  try {
    await page.waitForFunction(() => document.querySelector("#app")?.children.length > 0, null, { timeout: 30000 });
    mounted = Date.now() - started;
  } catch {}

  let feed = null;
  try {
    await page.waitForSelector(".information-card, .gate-card, .boot-screen", { timeout: 30000 });
    feed = Date.now() - started;
  } catch {}

  // 让首屏图片真的有机会发出去，再收网。
  await page.waitForTimeout(1500);

  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0] || {};
    const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
    return {
      responseStart: Math.round(n.responseStart || 0),
      domContentLoaded: Math.round(n.domContentLoadedEventEnd || 0),
      load: Math.round(n.loadEventEnd || 0),
      transferSize: n.transferSize || 0,
      paints,
      lcp: window.__lcp || 0,
      bodyText: document.body.innerText.slice(0, 120),
      cards: document.querySelectorAll(".information-card").length,
      images: document.images.length,
      lazyImages: [...document.images].filter((img) => img.loading === "lazy").length,
    };
  });
  const app = await page.evaluate(() => ({
    appChildren: document.querySelector("#app")?.children.length || 0,
    styleSheets: document.styleSheets.length,
  }));

  const rows = [...requests.values()];
  const byKind = {};
  for (const row of rows) {
    const kind = classify(row.url);
    byKind[kind] = byKind[kind] || { count: 0, bytes: 0 };
    byKind[kind].count += 1;
    byKind[kind].bytes += row.bytes || 0;
  }
  const slowest = rows
    .filter((row) => row.bytes)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 8)
    .map((row) => ({ url: new URL(row.url).pathname, kind: classify(row.url), kb: kb(row.bytes), status: row.status }));

  const result = {
    run: index + 1,
    throttle: THROTTLE,
    ua: UA_KIND,
    authenticated: Boolean(COOKIE),
    commit,
    mounted,
    feed,
    nav,
    app,
    totalKB: kb(rows.reduce((sum, row) => sum + (row.bytes || 0), 0)),
    requests: rows.length,
    byKind: Object.fromEntries(Object.entries(byKind).map(([kind, value]) => [kind, { count: value.count, kb: kb(value.bytes) }])),
    slowest,
    failures,
    consoleErrors,
  };
  await context.close();
  return result;
}

function markdown(runs, meta) {
  const lines = [];
  lines.push(`# 第一次打开 · ${meta.host} · ${new Date().toLocaleString("sv-SE").slice(0, 16)}`);
  lines.push("");
  lines.push(`- 测点：${meta.base}`);
  lines.push(`- 浏览器：Chromium（Playwright）· 空缓存 / 空 localStorage · ${meta.ua} · 网络 ${meta.throttle}`);
  lines.push(`- 登录态：${meta.authenticated ? "有会话 cookie" : "未登录"}`);
  lines.push("");
  lines.push("| 轮次 | 首字节 | 挂载 | 首条内容 | FCP | LCP | DCL | load | 请求 | 总传输 | 图片 | 接口 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of runs) {
    lines.push(
      `| ${r.run} | ${r.nav.responseStart} | ${r.mounted ?? "-"} | ${r.feed ?? "-"} | ${r.nav.paints["first-paint"] ?? "-"} | ${r.nav.lcp || "-"} | ${r.nav.domContentLoaded} | ${r.nav.load} | ${r.requests} | ${r.totalKB}KB | ${r.byKind.image?.kb ?? 0}KB | ${r.byKind.api?.kb ?? 0}KB |`
    );
  }
  lines.push("");
  lines.push("> 毫秒；传输量是响应字节（压缩后），不含请求头。每轮都是新的浏览器上下文，所以每轮都是冷缓存。");
  lines.push("");
  const first = runs[0];
  lines.push("最大资源：");
  lines.push("");
  lines.push("| 路径 | 类别 | 大小 | 状态 |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of first.slowest) lines.push(`| \`${row.url}\` | ${row.kind} | ${row.kb}KB | ${row.status} |`);
  lines.push("");
  if (first.failures.length) {
    lines.push("失败请求：");
    lines.push("");
    for (const line of first.failures.slice(0, 10)) lines.push(`- ${line}`);
    lines.push("");
  }
  if (first.consoleErrors.length) {
    lines.push("控制台错误：");
    lines.push("");
    for (const line of first.consoleErrors.slice(0, 10)) lines.push(`- ${line}`);
  }
  return lines.join("\n");
}

const browser = await chromium.launch({ args: ["--no-proxy-server"] });
const runs = [];
try {
  for (let i = 0; i < RUNS; i++) {
    console.log(`第 ${i + 1}/${RUNS} 轮 ...`);
    runs.push(await measureOnce(browser, i));
  }
} finally {
  await browser.close();
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = OUT || path.join("results", `first-open-${stamp}`);
fs.mkdirSync(dir, { recursive: true });
const meta = {
  base: BASE,
  host: new URL(BASE).hostname,
  ua: UA_KIND,
  throttle: THROTTLE,
  authenticated: Boolean(COOKIE),
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(dir, "first-open.json"), JSON.stringify({ meta, runs }, null, 2));
const md = markdown(runs, meta);
fs.writeFileSync(path.join(dir, "first-open.md"), md);
console.log(md);
console.log(`\n结果目录：${path.resolve(dir)}`);
