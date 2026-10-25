import { arg } from "../lib/cli.mjs";
import { chromium } from "playwright";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeSite, summaryLines } from "../scripts/probe.mjs";

// 人这一层：真实 Chromium，一次一个用户，量「点开一页要等多久」。
//
// 不给并发用浏览器：100 个 Chromium 测的是压测机的 CPU，不是站点。
// 并发在 k6 那一层做。这里只回答两件事：
//   1. 每个页面在浏览器里能不能打开（含重定向、失败请求、控制台错误）；
//   2. 打开它花了多久（TTFB / DCL / LCP / 传输量）。
//
// 黑箱前提：只给 URL。页面清单从探测里来，不读站点配置、不认识仓库目录。
// 哪些页面要登录由站点自己决定：被路由守卫送回登录页的，记为 redirected，不算失败。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");


const BASE = String(arg("base", process.env.BENCH_BASE || "")).replace(/\/+$/, "");
if (!BASE) {
  console.error("必须给测点：--base https://<标签>.xknot.si");
  process.exit(2);
}
const RUNS = Math.max(1, Number(arg("runs", 3)));

// 会话 cookie 等同于密码：优先从 --cookie-file（一行，形如 knot_sid=...）读，
// 避免它进 ps 和 shell 历史。--cookie 还留着，README 已不再推荐。
function cookieFromFile(file) {
  try {
    const line = readFileSync(path.resolve(process.cwd(), file), "utf8")
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#")) || "";
    return line.replace(/^Cookie:\s*/i, "").replace(/^knot_sid=/, "");
  } catch {
    console.error(`读不到 Cookie 文件：${file}`);
    return "";
  }
}

const COOKIE = arg("cookie-file", "")
  ? cookieFromFile(String(arg("cookie-file", "")))
  : String(arg("cookie", process.env.KNOT_SID || ""));
const TOKEN = String(arg("token", process.env.KNOT_AGENT_TOKEN || ""));
// 上传只对登录后的会话有意义；没有 cookie 就跳过，不猜。
const ALLOW_WRITES = process.argv.includes("--allow-writes") && Boolean(COOKIE);
const VIEWPORT_FILTER = String(arg("viewport", "both"));
const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RESULTS_ROOT = path.join(ROOT, "results");
const OUT_DIR = path.resolve(ROOT, arg("out", path.join("results", `human-${STAMP}`)));

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 800 },
].filter((v) => VIEWPORT_FILTER === "both" || v.name === VIEWPORT_FILTER);

const LCP_INIT = () => {
  window.__lcp = null;
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) window.__lcp = Math.round(last.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {}
};

// 页面清单来自探测得到的路由。带 ?post= 的那条是卡片详情（discover 的弹窗），
// 只有快照里真有帖子时才加，否则那一条量到的只是空页。
function pagesFor(target) {
  const list = (target.routes || []).map((r) => ({
    label: r.label,
    path: r.path,
    expect: r.path === "/discover" ? "article.information-card" : null,
  }));
  // 插在 discover 后面；探测没给出 discover 就追加到末尾，不插到第 0 位。
  const at = list.findIndex((p) => p.label === "discover");
  const insert = (item) => {
    if (at >= 0) list.splice(at + 1, 0, item);
    else list.push(item);
  };
  if (target.board?.firstId) {
    insert({ label: "card", path: `/discover?post=${target.board.firstId}`, expect: "article.information-card" });
  }
  if (target.board?.query) {
    insert({ label: "discover?q", path: `/discover?q=${encodeURIComponent(target.board.query)}`, expect: null });
  }
  return list;
}

async function measure(page, target) {
  const started = Date.now();
  let status = 0;
  let error = "";
  try {
    const res = await page.goto(`${BASE}${target.path}`, { waitUntil: "load", timeout: 45_000 });
    status = res ? res.status() : 0;
  } catch (e) {
    error = String(e.message || e).split("\n")[0];
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  if (target.expect) await page.waitForSelector(target.expect, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(150);

  const timing = await page
    .evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const resources = performance.getEntriesByType("resource");
      const bytes = resources.reduce((n, r) => n + (r.transferSize || 0), 0);
      const slowest = resources
        .map((r) => ({ url: String(r.name).replace(location.origin, ""), ms: Math.round(r.duration) }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3);
      return {
        ttfb: nav.responseStart ? Math.round(nav.responseStart) : null,
        dcl: nav.domContentLoadedEventEnd ? Math.round(nav.domContentLoadedEventEnd) : null,
        load: nav.loadEventEnd ? Math.round(nav.loadEventEnd) : null,
        lcp: window.__lcp ?? null,
        resources: resources.length,
        transferKB: Math.round(bytes / 1024),
        slowest,
      };
    })
    .catch(() => ({}));

  const finalUrl = page.url();
  return {
    label: target.label,
    path: target.path,
    status,
    error,
    wallMs: Date.now() - started,
    redirected: finalUrl.replace(BASE, "") !== target.path,
    finalPath: finalUrl.replace(BASE, ""),
    cards: await page.locator("article.information-card").count().catch(() => 0),
    ...timing,
  };
}

async function uploadProbe(context) {
  let buffer;
  try {
    buffer = readFileSync(path.resolve(ROOT, "data/probe.png"));
  } catch {
    return { label: "upload", skipped: "缺 data/probe.png，先跑 node scripts/make-image.mjs" };
  }
  const started = Date.now();
  try {
    const res = await context.request.post(`${BASE}/api/web/uploads`, {
      multipart: { file: { name: "probe.png", mimeType: "image/png", buffer } },
    });
    return { label: "upload", status: res.status(), wallMs: Date.now() - started, bytes: buffer.length };
  } catch (e) {
    return { label: "upload", status: 0, error: String(e.message || e).split("\n")[0], wallMs: Date.now() - started };
  }
}

function median(values) {
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!clean.length) return null;
  return clean[Math.floor((clean.length - 1) / 2)];
}

// 失败的请求与控制台报错记在每一轮（run）上，不属于某一页。以前它们只写进
// human.json：表格里的「失败」只数每页自己的 HTTP 状态和导航异常，于是文件头
// 声称的「含失败请求、控制台错误」在表上看不到，error 也永远是 0。
function summarize(runs) {
  const byKey = new Map();
  const runErrors = new Map();
  for (const run of runs) {
    const bucket = runErrors.get(run.viewport) || { failed: 0, console: 0 };
    bucket.failed += (run.failed || []).length;
    bucket.console += (run.consoleErrors || []).length;
    runErrors.set(run.viewport, bucket);
  }
  for (const run of runs) {
    for (const item of run.pages) {
      const key = `${run.viewport}:${item.label}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(item);
    }
  }
  const rows = [];
  for (const [key, items] of byKey) {
    const [viewport, label] = key.split(":");
    rows.push({
      viewport,
      label,
      path: items[0]?.path || "",
      status: median(items.map((i) => i.status)),
      ttfb: median(items.map((i) => i.ttfb)),
      dcl: median(items.map((i) => i.dcl)),
      lcp: median(items.map((i) => i.lcp)),
      load: median(items.map((i) => i.load)),
      transferKB: median(items.map((i) => i.transferKB)),
      cards: median(items.map((i) => i.cards)),
      redirected: items.every((i) => i.redirected),
      errors: items.filter((i) => i.error || i.status >= 400).length,
      // 这一视口在所有轮次里累计的失败请求与控制台报错，和上面按页统计的
      // errors 分开写，免得把「三条资源 404」说成「这一页失败了三次」。
      netErrors: (runErrors.get(viewport) || {}).failed || 0,
      consoleErrors: (runErrors.get(viewport) || {}).console || 0,
    });
  }
  return rows;
}

// 备注列：三种失败分开写，读的人才知道是页面打不开、资源没下来，还是脚本报错。
function noteOf(row) {
  if (row.redirected) return "→ 登录页";
  const parts = [];
  if (row.errors) parts.push(`${row.errors} 次页面失败`);
  if (row.netErrors) parts.push(`${row.netErrors} 个请求失败`);
  if (row.consoleErrors) parts.push(`${row.consoleErrors} 条控制台报错`);
  return parts.join(" · ");
}

function print(rows) {
  const head = ["视口", "页面", "状态", "TTFB", "DCL", "LCP", "load", "KB", "备注"];
  console.log(head.map((h, i) => (i === 0 || i === 1 ? h.padEnd(20) : h.padStart(7))).join(""));
  for (const r of rows) {
    const note = noteOf(r);
    console.log(
      [
        String(r.viewport).padEnd(20),
        String(r.label).padEnd(20),
        String(r.status ?? "-").padStart(7),
        String(r.ttfb ?? "-").padStart(7),
        String(r.dcl ?? "-").padStart(7),
        String(r.lcp ?? "-").padStart(7),
        String(r.load ?? "-").padStart(7),
        String(r.transferKB ?? "-").padStart(7),
        ` ${note}`,
      ].join("")
    );
  }
}

function markdown(result) {
  const { meta, rows } = result;
  const out = [];
  out.push(`# 人这一层 · ${meta.host} · ${new Date(meta.generatedAt).toLocaleString("sv-SE").slice(0, 16)}`);
  out.push("");
  out.push(`- 测点：${meta.base}`);
  out.push(`- 浏览器：Chromium（Playwright）· ${meta.viewports.join(" / ")} 视口 · 每页取 ${meta.runs} 轮中位数`);
  out.push(`- 登录态：${meta.authenticated ? "有会话 cookie" : "未登录（被守卫送回的页面记为 → 登录页）"}`);
  out.push("");
  out.push("探测到的站点：");
  out.push("");
  for (const line of meta.summary) out.push(`- ${line}`);
  out.push("");
  out.push("| 视口 | 页面 | 状态 | TTFB | DCL | LCP | load | 传输 | 备注 |");
  out.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows) {
    const note = noteOf(r);
    out.push(
      `| ${r.viewport} | \`${r.label}\` | ${r.status ?? "-"} | ${r.ttfb ?? "-"} | ${r.dcl ?? "-"} | ${r.lcp ?? "-"} | ${r.load ?? "-"} | ${r.transferKB ?? "-"}KB | ${note} |`
    );
  }
  out.push("");
  out.push("> 毫秒。每轮都是新的浏览器上下文（空 HTTP 缓存），所以第一条是冷缓存，同一上下文里的后续页面会复用资源。");
  out.push("> LCP 由 LargestContentfulPaint 观察器取最后一次记录；DCL 是 DOMContentLoaded。");
  out.push("");
  return out.join("\n");
}

// 单个体感测量必须直连：macOS 的系统代理会把跨境往返换成代理链路，
// 量到的就不是站点本身。Playwright 默认跟随系统代理，这里显式关掉。
const browser = await chromium.launch({ args: ["--no-proxy-server"] });
console.log(`探测 ${BASE} ...`);
const target = await probeSite(BASE, { token: TOKEN });
const summary = summaryLines(target);
console.log(summary.join("\n"));

// 卡片详情的 id 不在探测结果里（省一次大响应解析），单独取一次快照的头几条。
if (target.board?.posts) {
  try {
    const res = await fetch(`${BASE}/discover.json`, { cache: "no-store" });
    const data = await res.json();
    const first = (data.information || [])[0] || {};
    target.board.firstId = first.id || "";
    const topics = (first.kMeta && first.kMeta.topics) || [];
    const raw = topics[0] || String(first.body || "").split(/\s+/).find((w) => w.length > 4) || "";
    target.board.query = String(raw).replace(/[^A-Za-z0-9-]/g, "").slice(0, 24);
  } catch {}
}

const targets = pagesFor(target);
const runs = [];

for (const viewport of VIEWPORTS) {
  for (let i = 0; i < RUNS; i++) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: "zh-CN",
      deviceScaleFactor: 1,
    });
    await context.addInitScript(LCP_INIT);
    if (COOKIE) {
      await context.addCookies([
        {
          name: "knot_sid",
          value: COOKIE,
          domain: new URL(BASE).hostname,
          path: "/",
          httpOnly: true,
          secure: BASE.startsWith("https:"),
        },
      ]);
    }
    const page = await context.newPage();
    const failed = [];
    const consoleErrors = [];
    page.on("requestfailed", (req) => failed.push(`${req.method()} ${req.url()} ${req.failure()?.errorText || ""}`));
    page.on("console", (msg) => msg.type() === "error" && consoleErrors.push(msg.text().slice(0, 200)));

    const pagesOut = [];
    for (const t of targets) pagesOut.push(await measure(page, t));
    if (ALLOW_WRITES) pagesOut.push(await uploadProbe(context));

    mkdirSync(OUT_DIR, { recursive: true });
    await page.goto(`${BASE}/discover`, { waitUntil: "load" }).catch(() => {});
    await page.screenshot({ path: path.join(OUT_DIR, `discover-${viewport.name}.png`) }).catch(() => {});
    runs.push({
      viewport: viewport.name,
      run: i + 1,
      authenticated: Boolean(COOKIE),
      failed,
      consoleErrors,
      pages: pagesOut,
    });
    await context.close();
    console.log(`完成 ${viewport.name} #${i + 1}`);
  }
}

await browser.close();

const rows = summarize(runs);
const result = {
  meta: {
    base: BASE,
    host: target.host,
    generatedAt: new Date().toISOString(),
    runs: RUNS,
    viewports: VIEWPORTS.map((v) => `${v.width}x${v.height}`),
    authenticated: Boolean(COOKIE),
    writes: ALLOW_WRITES,
    summary,
    target,
  },
  rows,
  runs,
};
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(path.join(OUT_DIR, "human.json"), JSON.stringify(result, null, 2));
writeFileSync(path.join(OUT_DIR, "human.md"), `${markdown(result)}\n`);

// 方便直接 open results/latest-human/human.md；指定 --out 到别处时不改这里的指针。
if (OUT_DIR.startsWith(RESULTS_ROOT + path.sep)) {
  try {
    const latest = path.join(RESULTS_ROOT, "latest-human");
    if (existsSync(latest)) rmSync(latest, { force: true });
    symlinkSync(OUT_DIR, latest);
  } catch {}
}

print(rows);
console.log(`\n结果：${path.join(OUT_DIR, "human.md")}`);
