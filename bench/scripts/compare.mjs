import { readFileSync } from "node:fs";
import path from "node:path";
import { probeSite } from "./probe.mjs";
import { ENDPOINT_LABELS } from "./report.mjs";

// 横向比较几个子域。只发 GET，不动数据，几秒钟出结果。
//
//   node scripts/compare.mjs wang.xknot.si cpswang.xknot.si
//   node scripts/compare.mjs --with-token wang.xknot.si      # 顺带问 Agent 身份
//
// 也可以比两份已经跑完的并发结果（逗号分隔，顺序就是表的列顺序）：
//   node scripts/compare.mjs --runs results/A,results/B

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function table(head, rows) {
  return [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function kb(bytes) {
  return typeof bytes === "number" ? `${Math.round(bytes / 1024)}KB` : "-";
}

function siteRow(label, sites, pick, fallback = "-") {
  return [label, ...sites.map((s) => pick(s) ?? fallback)];
}

async function compareProbes(urls, token) {
  const sites = [];
  for (const url of urls) {
    process.stdout.write(`探测 ${url} ... `);
    const target = await probeSite(url, { token });
    console.log("ok");
    sites.push(target);
  }

  const rows = [
    siteRow("主机", sites, (s) => s.host),
    siteRow("链路", sites, (s) => `${s.transport.protocol || "?"} / ${s.transport.alpn || "-"}`),
    siteRow("证书剩余", sites, (s) => (s.transport.certDaysLeft == null ? "-" : `${s.transport.certDaysLeft} 天`)),
    siteRow("实例", sites, (s) => (s.instance ? `${s.instance.name} · ${s.instance.release || s.instance.version}` : "-")),
    siteRow("首页字节", sites, (s) => s.entry?.bytes ?? "-"),
    siteRow("noscript 兜底", sites, (s) => (s.entry?.hasStaticFallback ? "✓" : "✗")),
    siteRow("主包", sites, (s) => (s.transport.mainBundle ? kb(s.transport.mainBundle.bytes) : "-")),
    siteRow("压缩", sites, (s) => s.transport.gzip || "-"),
    siteRow("快照条数", sites, (s) => s.board?.posts ?? "-"),
    siteRow("带图", sites, (s) => s.board?.withImages ?? "-"),
    siteRow("作者", sites, (s) => s.board?.authors ?? "-"),
    siteRow("访客浏览", sites, (s) => String(s.session?.guestBrowsing ?? "-")),
    siteRow("注册", sites, (s) => s.session?.registrationMode ?? "-"),
    siteRow("Agent", sites, (s) => s.agent?.displayName || "未提供码"),
    siteRow("管理入口", sites, (s) => (s.leaks.ok ? "未暴露" : `暴露（${s.leaks.adminPage}）`)),
    siteRow(
      "能力",
      sites,
      (s) =>
        Object.entries(s.capabilities)
          .map(([k, v]) => `${k}${v ? "✓" : "✗"}`)
          .join(" ")
    ),
    siteRow("首页 TTFB", sites, (s) => (s.entry ? `${s.entry.ttfbMs}ms` : "-")),
    siteRow("路由中位", sites, (s) => {
      const list = (s.routes || []).map((r) => r.ttfbMs).filter((n) => typeof n === "number");
      if (!list.length) return "-";
      list.sort((a, b) => a - b);
      return `${list[Math.floor((list.length - 1) / 2)]}ms`;
    }),
  ];

  console.log("");
  console.log(table(["项", ...sites.map((s) => s.host)], rows));
  console.log("");
  for (const s of sites) {
    for (const w of s.warnings || []) console.log(`${s.host}：${w}`);
  }
  console.log("");
  console.log("> 只有 GET。/ 与 /discover.json 由入口主机直接回；其它数字是单次请求，不做并发判定。");
  return sites;
}

function readSummary(dir) {
  const file = path.resolve(dir, dir.endsWith(".json") ? "" : "summary.json");
  return JSON.parse(readFileSync(file, "utf8"));
}

function compareRuns(dirs) {
  const runs = dirs.map(readSummary);
  const bases = runs.map((r) => r.meta.target?.host || new URL(r.meta.base).host);
  const levels = Array.from(new Set(runs.flatMap((r) => r.runs.map((x) => x.vus)))).sort((a, b) => a - b);
  const out = [];

  out.push(`# ${bases.join(" vs ")}`);
  out.push("");
  out.push(table(["项", ...runs.map((r) => r.meta.target?.host || r.meta.base)], [
    ["快照条数", ...runs.map((r) => r.meta.target?.board?.posts ?? "-")],
    ["ALPN", ...runs.map((r) => r.meta.target?.transport?.alpn ?? "-")],
    ["主包", ...runs.map((r) => kb(r.meta.target?.transport?.mainBundle?.bytes))],
    ["压缩", ...runs.map((r) => r.meta.target?.transport?.gzip ?? "-")],
    ["测点时间", ...runs.map((r) => new Date(r.meta.startedAt).toLocaleString("sv-SE").slice(0, 16))],
  ]));
  out.push("");

  // 每个端点在各并发下的 p95，两栏并排。
  for (const scenario of Array.from(new Set(runs.flatMap((r) => r.runs.map((x) => x.scenario))))) {
    const keys = Array.from(new Set(runs.flatMap((r) => r.runs.filter((x) => x.scenario === scenario).flatMap((x) => Object.keys(x.endpoints))))).sort(
      (a, b) => (ENDPOINT_LABELS[a] || a).localeCompare(ENDPOINT_LABELS[b] || b)
    );
    if (!keys.length) continue;
    const rows = keys.map((key) => [
      ENDPOINT_LABELS[key] || key,
      ...runs.map((r) => {
        const cells = levels.map((vus) => {
          const run = r.runs.find((x) => x.scenario === scenario && x.vus === vus);
          const ep = run?.endpoints?.[key];
          return ep ? Math.round(ep.p95) : "-";
        });
        return cells.join(" / ");
      }),
    ]);
    out.push(`## ${scenario} · p95（${levels.join(" / ")} 并发）`);
    out.push("");
    out.push(table(["端点", ...runs.map((r) => r.meta.target?.host || r.meta.base)], rows));
    out.push("");
  }

  out.push("> 只有同一台压测机、同一时段跑出来的两份结果才值得并排看。");
  return out.join("\n");
}

const runDirs = arg("runs", "");
if (runDirs) {
  console.log(compareRuns(runDirs.split(",").map((s) => s.trim())));
} else {
  // 位置参数就是子域；跳过 --flag 和 --flag 后面的取值。
  const positional = [];
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a.startsWith("--")) {
      if (a === "--runs") i++;
      continue;
    }
    positional.push(a);
  }
  if (!positional.length) {
    console.error("用法：node scripts/compare.mjs <标签>.xknot.si [...] [--with-token]");
    console.error("      node scripts/compare.mjs --runs results/A,results/B");
    process.exit(2);
  }
  const urls = positional.map((a) => (a.startsWith("http") ? a : `https://${a}`));
  const withToken = process.argv.includes("--with-token");
  const token = withToken ? String(process.env.KNOT_AGENT_TOKEN || "") : "";
  if (withToken && !token) console.warn("给了 --with-token 但 KNOT_AGENT_TOKEN 是空的，Agent 一栏会显示未提供码。");
  await compareProbes(urls, token);
}
