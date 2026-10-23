#!/usr/bin/env node
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeSite, summaryLines } from "./probe.mjs";
import { render } from "./report.mjs";
import { parseSummaryData } from "./summary.mjs";
import { exitCodeFor, failureRecord } from "./failures.mjs";

// 并发层编排：先黑箱探测这个站点，再按能测的场景一档一档跑 k6。
//
// 入口只有一个 URL。脚本不读站点配置、不假设本机、不 import 仓库里任何东西。
// 探测结果（TLS、版本、快照条数、能力位）跟着每份报告一起存，
// 这样两个月后配置变了，两张表也能对齐着看。
//
// 每档之前不重跑 warmup：warmup 只在每个场景开头做一次（1 VU × 5s）。
// 它热的是服务端（缓存、连接池、隧道）以及入口主机的 TCP/TLS 会话缓存，
// 不是客户端连接：每档都是一个新起的 k6 进程，它的 keep-alive 连接全部重建，
// 所以每档开头仍会混进一批冷连接样本。要消掉这部分，只能把各档放进同一个 k6
// 进程（同一 scenario 的 stages），那会让档间冷却与失败隔离都做不了。
// 每档之间停 COOLDOWN 秒，让 Postgres 的连接和队列回落到基线，
// 否则 100 并发会把尾巴带进下一档。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const K6 = process.env.K6_BIN || "k6";


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

// 身份：直连源站时默认按 VU 给独立 XFF；公网入口只能靠多份 Cookie / 授权码。
const RAW_IDENTITY = String(arg("identity", process.env.BENCH_IDENTITY || "")).toLowerCase();
if (RAW_IDENTITY && !["shared", "xff"].includes(RAW_IDENTITY)) {
  console.error(`--identity 只能是 shared 或 xff，收到：${RAW_IDENTITY}`);
  process.exit(2);
}
const IDENTITY_MODE = RAW_IDENTITY || (isDirectBase(BASE) ? "xff" : "shared");
const COOKIES = resolveCookies();
const TOKENS = resolveTokens();
const IDENTITY_WARNING =
  IDENTITY_MODE === "xff" && !isDirectBase(BASE)
    ? "入口 nginx 会把真实 IP 追加到 X-Forwarded-For 右侧，公网打 XFF 不会换身份；要分身份请用 --cookies-file 或多份 Agent 授权码"
    : "";

const STAMP = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RESULTS_ROOT = path.join(ROOT, "results");
const OUT_DIR = path.resolve(ROOT, arg("out", path.join("results", STAMP)));
const RAW_DIR = path.join(OUT_DIR, "raw");

// 授权码只从环境变量或显式给的 --token-file 读；不打印、不写进结果文件。
// 黑箱前提：文件在谁的机器上都行，脚本不认识仓库目录结构。
//
// 一份授权码就是一个身份。要给每个 VU 分身份，就在文件里放多行
// KNOT_AGENT_TOKEN=...，或用 KNOT_AGENT_TOKENS（换行/逗号分隔）。
function normalizeToken(raw) {
  const text = String(raw || "").trim();
  const value = text.startsWith("KNOT_AGENT_TOKEN=")
    ? text.slice(text.indexOf("KNOT_AGENT_TOKEN=") + "KNOT_AGENT_TOKEN=".length)
    : text;
  return value.trim().replace(/^["']|["']$/g, "");
}

function resolveTokens() {
  const fromEnv = String(process.env.KNOT_AGENT_TOKENS || "")
    .split(/[\n,]/)
    .map(normalizeToken)
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;

  const single = normalizeToken(process.env.KNOT_AGENT_TOKEN || "");
  const file = arg("token-file", "");
  if (!file) return single ? [single] : [];

  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    console.warn(`授权码文件不存在：${abs}`);
    return single ? [single] : [];
  }
  const text = readFileSync(abs, "utf8");
  const tokens = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map(normalizeToken)
    .filter(Boolean);
  if (!tokens.length) {
    console.warn(`授权码文件里没有可用的授权码：${abs}`);
    return single ? [single] : [];
  }
  return tokens;
}

// Cookie 文件：每行一个完整的 Cookie 头（如 knot_sid=...），一个 Cookie 就是一个身份。
// 这是公网入口上唯一能真正把 VU 分开的办法——入口 nginx 会把真实 IP 追加到 XFF 右边，
// 冒充 XFF 不会换身份。
function resolveCookies() {
  const fromEnv = String(process.env.BENCH_COOKIES || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
  if (fromEnv.length) return fromEnv;

  const file = arg("cookies-file", "");
  if (!file) return [];
  const abs = path.resolve(process.cwd(), file);
  if (!existsSync(abs)) {
    console.warn(`Cookie 文件不存在：${abs}`);
    return [];
  }
  return readFileSync(abs, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function isDirectBase(base) {
  return isDirectHost(new URL(base).hostname);
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

// k6 的 --duration 可以写 30s、5m、1h、1m30s。旧的超时估算把单位剥掉只取数字，
// "5m" 变成 5 秒，5 分钟那一档会在第 125 秒被 spawnSync 杀掉，然后按「没跑成」消失。
// 这里按单位换算；认不出的写法宁可给足余量（30 分钟），也不要提前杀人。
function durationSeconds(text) {
  const value = String(text ?? "").trim();
  if (/^\d+(?:\.\d+)?m\d+(?:\.\d+)?s$/.test(value)) {
    const [, m, s] = /^(\d+(?:\.\d+)?)m(\d+(?:\.\d+)?)s$/.exec(value);
    return Number(m) * 60 + Number(s);
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] || "s";
  if (unit === "ms") return amount / 1000;
  if (unit === "m") return amount * 60;
  if (unit === "h") return amount * 3600;
  return amount;
}

function runK6({ script, vus, duration, out, token, allowWrites = false }) {
  const started = Date.now();
  const seconds = durationSeconds(duration);
  const res = spawnSync(K6, ["run", "--quiet", "--summary-export", out, script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: (seconds == null ? 30 * 60 : seconds + 120) * 1000,
    env: {
      ...process.env,
      BASE,
      VUS: String(vus),
      DURATION: String(duration),
      KNOT_AGENT_TOKEN: token || "",
      KNOT_AGENT_TOKENS: TOKENS.join("\n"),
      BENCH_COOKIES: COOKIES.join("\n"),
      BENCH_IDENTITY: IDENTITY_MODE,
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
    // 超时被 kill 时 status 是 null、signal 有值；区分「自己崩了」和「被杀了」，
    // 否则失败记录只剩一句「失败」，看不出是 k6 的问题还是 timeout 估短了。
    return {
      ok: false,
      elapsed,
      status: res.status,
      signal: res.signal,
      error: res.error,
      tail: String(res.stderr || res.stdout || "").split("\n").slice(-8).join("\n"),
    };
  }
  // k6 说成功却没写导出文件：这一档没有数据，同样不能当成跑过。
  if (!existsSync(out)) {
    return {
      ok: false,
      elapsed,
      status: res.status,
      signal: res.signal,
      error: null,
      reason: "k6 退出码 0 但没有写出 --summary-export 文件",
    };
  }
  // k6 的 console.warn 走 stderr，退出码 0 时以前整段被丢掉。那些话正是
  // 「Agent 信息流为空，卡片详情将跳过」这类「某个端点为什么没数据」的唯一线索，
  // 对应的 ep_* 指标根本不产生，报告里那一行也就凭空消失。至少把它们打出来。
  const warnings = String(res.stderr || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(WARN|ERRO)/i.test(line));
  return { ok: true, elapsed, warnings };
}

function parseSummary(file) {
  return parseSummaryData(JSON.parse(readFileSync(file, "utf8")));
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
function skippable(scenario, target) {
  if (scenario === "read" && !target.capabilities.webApi) {
    return "Web API 不可用（/api/web/session 不是 200）";
  }
  if (scenario === "agent") {
    if (!TOKENS.length) return "没有授权码（KNOT_AGENT_TOKEN(S) 或 --token-file）";
    if (!target.capabilities.agentApi) return "授权码在目标站点上无效";
  }
  if (scenario === "write") {
    if (!ALLOW_WRITES) return "写场景需要显式同意（--allow-writes 或 ALLOW_WRITES=1）";
    if (!TOKENS.length) return "写场景需要站点自己的个人 Agent 授权码";
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

  const token = TOKENS[0] || "";
  const identityMode = COOKIES.length ? "cookie" : IDENTITY_MODE;
  const maxVus = Math.max(...LEVELS);
  if (IDENTITY_WARNING) console.warn(`身份：${IDENTITY_WARNING}`);
  if (SCENARIOS.includes("read") && !COOKIES.length && IDENTITY_MODE !== "xff" && maxVus > 1) {
    console.warn("身份：访客读的所有 VU 共享出口 IP，检索超过 120 次/分钟会 429（报告单列，不算错误）");
  }
  if (COOKIES.length && COOKIES.length < maxVus) {
    console.warn(`身份：只有 ${COOKIES.length} 份 Cookie，最高 ${maxVus} 并发，部分 VU 会共用身份`);
  }
  if (TOKENS.length && TOKENS.length < maxVus && SCENARIOS.some((s) => s === "agent" || s === "write")) {
    console.warn(`身份：只有 ${TOKENS.length} 份 Agent 授权码，最高 ${maxVus} 并发，部分 VU 会共用身份`);
  }

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
    token: Boolean(TOKENS.length),
    identity: {
      mode: identityMode,
      cookies: COOKIES.length,
      tokens: TOKENS.length,
      warning: IDENTITY_WARNING,
    },
    levels: LEVELS,
    scenarios: SCENARIOS,
    skipped: [],
    // 跑失败或没写出数据的档。报告与退出码都从这里取，不再只是控制台的一行字。
    failed: [],
    // k6 自己在运行中说过的话（例如「信息流为空，卡片详情跳过」）。以前退出码 0
    // 就整段丢弃，于是某个端点没有指标，报告里连一行说明都没有。
    warnings: [],
  };

  console.log(`\nk6 ${k6} · 每档 ${DURATION} · 冷却 ${COOLDOWN}s`);
  console.log(
    `身份 ${identityMode}${COOKIES.length ? ` · Cookie ${COOKIES.length} 份` : ""}${TOKENS.length ? ` · 授权码 ${TOKENS.length} 份` : ""}\n`
  );

  const runs = [];
  for (const scenario of SCENARIOS) {
    const why = skippable(scenario, target);
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
    if (!warm.ok) {
      // 预热失败不单列成一档（它没有指标），但要说清是退出码还是被杀的。
      const failed = failureRecord({ scenario, vus: 1, elapsedMs: warm.elapsed, ...warm });
      console.warn(`预热失败（不计入判定）：${failed.detail}`);
    } else {
      for (const warning of warm.warnings || []) {
        meta.warnings.push(`${scenario} 预热：${warning}`);
        console.log(`  k6 提示：${warning}`);
      }
    }

    for (const vus of levels) {
      const out = path.join(RAW_DIR, `${scenario}-${vus}.json`);
      process.stdout.write(`[${scenario}] ${vus} 并发 ... `);
      const res = runK6({ script, vus, duration: DURATION, out, token, allowWrites: scenario === "write" });
      if (!res.ok) {
        const failed = failureRecord({ scenario, vus, elapsedMs: res.elapsed, ...res });
        console.log(`失败（${Math.round(res.elapsed / 1000)}s）`);
        console.log(failed.detail);
        // 只 continue 的后果：这一档不进 runs，报告的列由 runs 反推，
        // 于是它连表头都不出现，判定段还按剩下的档写「未超过验收线」。
        meta.failed.push(failed);
        continue;
      }
      for (const warning of res.warnings || []) {
        meta.warnings.push(`${scenario} ${vus} 并发：${warning}`);
        console.log(`  k6 提示：${warning}`);
      }
      let parsed;
      try {
        parsed = parseSummary(out);
      } catch (error) {
        const failed = failureRecord({ scenario, vus, elapsedMs: res.elapsed, reason: "导出文件无法解析", tail: error.message });
        console.log(`失败（导出文件无法解析）`);
        console.log(failed.detail);
        meta.failed.push(failed);
        continue;
      }
      runs.push({ scenario, vus, duration: DURATION, elapsedMs: res.elapsed, ...parsed });
      console.log(
        `RPS ${parsed.rps ? parsed.rps.toFixed(1) : "-"} · p95 ${parsed.overall.p95 ? Math.round(parsed.overall.p95) + "ms" : "-"} · 错误 ${parsed.errorRate == null ? "-" : `${(parsed.errorRate * 100).toFixed(2)}%`}${res.thresholdFailed ? " · k6 阈值未过" : ""}`
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
  if (meta.failed.length) {
    console.error(`有 ${meta.failed.length} 档没有跑成，结论不完整（见 summary.md 的「本轮未测」）。`);
  }
  // 有档位失败仍退出 0 的话，调用方只会看到「跑完了一轮」。
  process.exitCode = exitCodeFor(meta);
}

await main();
