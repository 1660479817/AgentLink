#!/usr/bin/env node
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeSite, summaryLines } from "./probe.mjs";
import { render } from "./report.mjs";

// 并发层编排：先黑箱探测这个站点，再按能测的场景一档一档跑 k6。
//
// 入口只有一个 URL。脚本不读站点配置、不假设本机、不 import 仓库里任何东西。
// 探测结果（TLS、版本、快照条数、能力位）跟着每份报告一起存，
// 这样两个月后配置变了，两张表也能对齐着看。
//
// 每档之前不重跑 warmup：warmup 只在每个场景开头做一次（1 VU × 5s），
// 后面各档共用已经热起来的 TLS、隧道和连接池。每档之间停一会儿，
// 让 Postgres 的连接和队列回落到基线，否则 100 并发会把尾巴带进下一档。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const K6 = process.env.K6_BIN || "k6";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = String(arg("base", process.env.BENCH_BASE || "")).replace(/\/+$/, "");
if (!BASE) {
  console.error("必须给测点：--base https://<标签>.xknot.si");
  process.exit(2);
}
const DURATION = String(arg("duration", "30s"));
const COOLDOWN = Number(arg("cooldown", 15));
const LABEL = String(arg("label", ""));
const ALLOW_WRITES = flag("allow-writes") || String(process.env.ALLOW_WRITES || "") === "1";
const SCENARIOS = String(arg("scenario", "read,agent"))
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const LEVELS = String(arg("levels", "5,10,20,30,50,100"))
  .split(",")
  .map((n) => Number(n.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RESULTS_ROOT = path.join(ROOT, "results");
const OUT_DIR = path.resolve(ROOT, arg("out", path.join("results", STAMP)));
const RAW_DIR = path.join(OUT_DIR, "raw");

// 授权码只从环境变量或显式给的 --token-file 读；不打印、不写进结果文件。
// 黑箱前提：文件在谁的机器上都行，脚本不认识仓库目录结构。
function resolveToken() {
  if (process.env.KNOT_AGENT_TOKEN) return process.env.KNOT_AGENT_TOKEN.trim();
  const file = arg("token-file", "");
  if (!file) return "";
  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    console.warn(`授权码文件不存在：${abs}`);
    return "";
  }
  const text = readFileSync(abs, "utf8");
  const line = text.split("\n").find((l) => l.trim().startsWith("KNOT_AGENT_TOKEN="));
  if (!line) {
    console.warn(`授权码文件里没有 KNOT_AGENT_TOKEN= 这一行：${abs}`);
    return "";
  }
  return line.slice(line.indexOf("KNOT_AGENT_TOKEN=") + "KNOT_AGENT_TOKEN=".length).trim().replace(/^["']|["']$/g, "");
}

function k6Version() {
  try {
    return execFileSync(K6, ["version"], { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return "k6 not found";
  }
}

function gitRev() {
  // 测量脚本自己的版本。改过脚本再跑，数字才有出处。
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: HERE, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runK6({ script, vus, duration, out, token, allowWrites = false }) {
  const started = Date.now();
  const res = spawnSync(K6, ["run", "--quiet", "--summary-export", out, script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: (Number(String(duration).replace(/[^\d.]/g, "")) + 120) * 1000,
    env: {
      ...process.env,
      BASE,
      VUS: String(vus),
      DURATION: String(duration),
      KNOT_AGENT_TOKEN: token || "",
      ...(allowWrites ? { ALLOW_WRITES: "1" } : { ALLOW_WRITES: "" }),
    },
  });
  const elapsed = Date.now() - started;
  // 退出码 99 是「阈值没过」，不是「没跑成」：summary 已经写出来了，照样收进报告。
  // 写场景用阈值守住删除失败，那一条要显眼，但不能把其余指标一起丢掉。
  if (res.status === 99 && existsSync(out)) {
    return { ok: true, elapsed, thresholdFailed: true };
  }
  if (res.status !== 0) {
    const detail = String(res.stderr || res.stdout || "").split("\n").slice(-8).join("\n");
    return { ok: false, elapsed, detail };
  }
  return { ok: true, elapsed };
}

// k6 2.x 的 --summary-export 把 values 拍平到指标对象上；旧版包一层 values。
function metricValues(metric) {
  return (metric && (metric.values || metric)) || {};
}

function parseSummary(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const metrics = raw.metrics || {};
  const endpoints = {};

  for (const [name, metric] of Object.entries(metrics)) {
    const match = /^ep_(.+)_ms$/.exec(name);
    if (!match) continue;
    const key = match[1];
    const values = metricValues(metric);
    const err = metrics[`ep_${key}_err`];
    endpoints[key] = {
      count: values.count ?? null,
      p50: values.med ?? values["p(50)"] ?? null,
      p95: values["p(95)"] ?? null,
      p99: values["p(99)"] ?? null,
      max: values.max ?? null,
      errRate: metricValues(err).value ?? metricValues(err).rate ?? 0,
    };
  }

  const totals = metricValues(metrics.http_reqs);
  let weightedErrors = 0;
  let weightedCount = 0;
  for (const ep of Object.values(endpoints)) {
    const n = ep.count || 0;
    weightedErrors += (ep.errRate || 0) * n;
    weightedCount += n;
  }

  const dur = metricValues(metrics.http_req_duration);
  return {
    requests: totals.count ?? 0,
    rps: totals.rate ?? null,
    errorRate: weightedCount ? weightedErrors / weightedCount : 0,
    overall: { p50: dur.med ?? null, p95: dur["p(95)"] ?? null, p99: dur["p(99)"] ?? null },
    endpoints,
  };
}

function scriptFor(scenario) {
  const map = {
    read: path.join(ROOT, "k6", "read.js"),
    agent: path.join(ROOT, "k6", "agent-read.js"),
    write: path.join(ROOT, "k6", "write.js"),
  };
  return map[scenario] || "";
}

// 一个场景能不能跑，只看探测结果和手里有没有授权码，不看它是哪个子域。
function skippable(scenario, target, token) {
  if (scenario === "read" && !target.capabilities.webApi) {
    return "Web API 不可用（/api/web/session 不是 200）";
  }
  if (scenario === "agent") {
    if (!token) return "没有授权码（KNOT_AGENT_TOKEN 或 --token-file）";
    if (!target.capabilities.agentApi) return "授权码在目标站点上无效";
  }
  if (scenario === "write") {
    if (!ALLOW_WRITES) return "写场景需要显式同意（--allow-writes 或 ALLOW_WRITES=1）";
    if (!token) return "写场景需要站点自己的个人 Agent 授权码";
  }
  if (!scriptFor(scenario)) return `未知场景 ${scenario}`;
  return "";
}

async function main() {
  const k6 = k6Version();
  if (!k6.startsWith("k6 v")) {
    console.error("找不到 k6。安装：brew install k6");
    process.exit(1);
  }
  mkdirSync(RAW_DIR, { recursive: true });

  const token = resolveToken();
  console.log(`探测 ${BASE} ...`);
  const target = await probeSite(BASE, { token });
  console.log(summaryLines(target).join("\n"));
  writeFileSync(path.join(OUT_DIR, "probe.json"), JSON.stringify(target, null, 2));

  const meta = {
    base: BASE,
    host: target.host,
    target,
    machine: `${os.platform()}/${os.arch()} ${os.release()}`,
    label: LABEL,
    k6,
    git: gitRev(),
    duration: DURATION,
    cooldown: COOLDOWN,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    token: Boolean(token),
    levels: LEVELS,
    scenarios: SCENARIOS,
    skipped: [],
  };

  console.log(`\nk6 ${k6} · 每档 ${DURATION} · 冷却 ${COOLDOWN}s\n`);

  const runs = [];
  for (const scenario of SCENARIOS) {
    const why = skippable(scenario, target, token);
    if (why) {
      console.log(`[${scenario}] 跳过：${why}`);
      meta.skipped.push({ scenario, reason: why });
      continue;
    }
    const script = scriptFor(scenario);
    if (scenario === "write" && !existsSync(path.join(ROOT, "data", "probe.png"))) {
      execFileSync(process.execPath, [path.join(ROOT, "scripts", "make-image.mjs")], { stdio: "inherit" });
    }

    // 写场景默认只跑低档：每条都是 INSERT + 审核入队，先量 5 和 10。
    const levels = scenario === "write" && !arg("levels", "") ? [5, 10] : LEVELS;

    console.log(`[${scenario}] 预热 1 VU × 5s`);
    const warm = runK6({
      script,
      vus: 1,
      duration: "5s",
      out: path.join(RAW_DIR, `${scenario}-warmup.json`),
      token,
      allowWrites: scenario === "write",
    });
    if (!warm.ok) console.warn(`预热失败：${warm.detail}`);

    for (const vus of levels) {
      const out = path.join(RAW_DIR, `${scenario}-${vus}.json`);
      process.stdout.write(`[${scenario}] ${vus} 并发 ... `);
      const res = runK6({ script, vus, duration: DURATION, out, token, allowWrites: scenario === "write" });
      if (!res.ok) {
        console.log(`失败（${Math.round(res.elapsed / 1000)}s）`);
        console.log(res.detail);
        continue;
      }
      const parsed = parseSummary(out);
      runs.push({ scenario, vus, duration: DURATION, elapsedMs: res.elapsed, ...parsed });
      console.log(
        `RPS ${parsed.rps ? parsed.rps.toFixed(1) : "-"} · p95 ${parsed.overall.p95 ? Math.round(parsed.overall.p95) + "ms" : "-"} · 错误 ${(parsed.errorRate * 100).toFixed(2)}%${res.thresholdFailed ? " · k6 阈值未过" : ""}`
      );
      if (vus !== levels[levels.length - 1]) await sleep(COOLDOWN * 1000);
    }
  }

  meta.finishedAt = new Date().toISOString();
  const result = { meta, runs };
  writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(result, null, 2));

  const markdown = render(result);
  writeFileSync(path.join(OUT_DIR, "summary.md"), `${markdown}\n`);

  // latest 只在结果落在 results/ 里时才建：指定 --out 到别处是临时跑，不该动仓库里的指针。
  if (OUT_DIR.startsWith(RESULTS_ROOT + path.sep)) {
    try {
      mkdirSync(RESULTS_ROOT, { recursive: true });
      const latest = path.join(RESULTS_ROOT, "latest");
      if (existsSync(latest)) execFileSync("rm", ["-f", latest]);
      execFileSync("ln", ["-s", OUT_DIR, latest]);
    } catch {}
  }

  console.log(`\n${markdown}\n`);
  console.log(`结果目录：${OUT_DIR}`);
}

await main();
