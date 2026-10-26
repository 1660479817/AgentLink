#!/usr/bin/env node
// OpenClaw 宿主侧探测：只记录，不判定，永远退出 0。
//
// 它由单元按五分钟一次拉起，把「这台机器上的 OpenClaw 现在什么样」写成一份文件，
// 由 Backend 只读地取走。任何时候都不在 HTTP 请求里执行 CLI——那条热路径上不该
// 出现一个可能卡住二十秒的子进程。
//
// 三条硬约束：
//   1. 永远退出 0。非零退出会诱使监管进程把一次观测当成一次故障。
//   2. 解析不了一律 unknown，绝不记成失败。信息缺失就报成信息缺失。
//   3. 磁盘上已经是 off 就原样写回：那是部署的决定，不是一次读数。

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { invokedDirectly } from "../scripts/lib/main-module.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST = path.join(HERE, "manifest.json");
const CLI_TIMEOUT_MS = 20_000;
// 便宜的检查每轮都做；贵的（agents list、cron list）一小时一次，中间复用上次结果。
// 单元里的间隔是 300 秒，与这里没有耦合：改间隔只是让便宜的检查更勤。
const EXPENSIVE_MS = 60 * 60_000;

export function probePaths(env = process.env) {
  const root = String(env.KNOT_DEPLOY_ROOT || "").trim();
  if (!root) return null;
  const run = path.join(root, "var", "run");
  return {
    status: path.join(run, "openclaw-status.json"),
    sync: path.join(run, "openclaw-sync.json"),
    request: path.join(run, "openclaw-probe.request"),
  };
}

function defaultExec(file, args) {
  try {
    return execFileSync(file, args, {
      encoding: "utf8",
      timeout: CLI_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

async function readModelConfigured(stateDir) {
  const config = await readJson(path.join(stateDir, "openclaw.json"));
  if (!config) return false;
  const providers = (config.models && config.models.providers) || {};
  const hasModel = Object.values(providers).some((entry) => Array.isArray(entry?.models) && entry.models.length > 0);
  const hasAuth = Boolean(config.auth?.profiles && Object.keys(config.auth.profiles).length > 0);
  return hasModel && hasAuth;
}

// 「本该有谁」由同步写下，不在这里猜。同步报告缺失时退回仓库里的 manifest，
// 拿到的是同一个名单，只是少了「这次部署打算装哪些」这层信息。
async function expectedAgents({ sync }) {
  if (Array.isArray(sync?.agents) && sync.agents.length) return sync.agents.map(String);
  const manifest = await readJson(MANIFEST);
  return (manifest?.agents || []).map((agent) => agent?.id).filter(Boolean);
}

// agents list 的格式由 OpenClaw 决定，这里只做子串匹配：
// 名单是我们自己写的，误判成「已注册」的概率远低于漏判成「没注册」的代价。
function countRegistered(output, expected) {
  const text = String(output || "");
  const missing = expected.filter((id) => !text.includes(id));
  return { expected: expected.length, registered: expected.length - missing.length, missing };
}

async function writeStatus(file, status) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
}

export async function collect({
  paths,
  stateDir = process.env.OPENCLAW_STATE_DIR || path.join(process.env.HOME || os.homedir(), ".openclaw"),
  port = Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789,
  now = Date.now(),
  exec = defaultExec,
} = {}) {
  const checkedAt = new Date(now).toISOString();
  const previous = paths ? await readJson(paths.status) : null;

  // 部署明说关闭：这是一条决定，不是一个读数。原样写回，只更新时间，
  // 否则探测会在五分钟内把它换成 unknown，控制台就丢掉了唯一被明确告知的事实。
  if (previous?.state === "off") return { state: "off", checkedAt };

  const sync = paths ? await readJson(paths.sync) : null;
  const force = paths ? await exists(paths.request) : false;

  const rawVersion = exec("openclaw", ["--version"]);
  const version = rawVersion ? (String(rawVersion).match(/\d{4}\.\d+\.\d+/) || [null])[0] : null;

  if (!version) {
    return { state: "unknown", checkedAt, reason: "not_installed", stateDir };
  }

  const gatewayOk = exec("openclaw", ["gateway", "health", "--port", String(port)]) !== null;
  const model = await readModelConfigured(stateDir);

  // 贵的两项先看上次的结果，够新就复用。探测只有便宜到可以整天跑才有意义。
  // 缓存里的时间是 ISO 字符串：人能读，但比较前要 parse，别直接 Number()。
  const cached = previous?.cache || {};
  const agentsCachedAt = Date.parse(cached.agentsAt || "");
  const cacheFresh = !force && Number.isFinite(agentsCachedAt) && now - agentsCachedAt < EXPENSIVE_MS;
  let agents = cacheFresh ? previous?.agents : null;
  let cron = cacheFresh ? previous?.cron : null;
  const cache = cacheFresh
    ? { agentsAt: cached.agentsAt, cronAt: cached.cronAt }
    : { agentsAt: checkedAt, cronAt: checkedAt };

  if (!agents) {
    agents = countRegistered(exec("openclaw", ["agents", "list"]), await expectedAgents({ sync }));
  }
  if (!cron) {
    const listed = exec("openclaw", ["cron", "list", "--all", "--json"]);
    cron = { patrol: listed == null ? "unknown" : String(listed).includes("knot-admin-patrol") ? "ok" : "missing" };
  }

  const degraded = !gatewayOk || !model || agents.missing.length > 0 || cron.patrol !== "ok";

  return {
    state: degraded ? "degraded" : "ok",
    checkedAt,
    stateDir,
    version,
    gateway: { ok: gatewayOk, port },
    model: { configured: model },
    agents,
    cron,
    cache,
  };
}

async function main() {
  const paths = probePaths();
  if (!paths) {
    // 没有部署根就不写文件：猜一个路径比没有文件更糟。
    console.error("warn: 没有 KNOT_DEPLOY_ROOT，探测这次不写状态");
    return;
  }
  try {
    const status = await collect({ paths });
    await writeStatus(paths.status, status);
    // 把解析到的 state 目录打出来：写错的 OPENCLAW_STATE_DIR 在日志里就该看得见，
    // 而不是一周后表现为一个沉默的 unknown。
    console.log(`state dir: ${status.stateDir || "(未解析)"}`);
    console.log(`state: ${status.state}${status.reason ? ` (${status.reason})` : ""}`);
    if (await exists(paths.request)) await rm(paths.request, { force: true });
  } catch (error) {
    console.error(`warn: 探测没写成：${error.message}`);
  }
}

// 这一行是契约：探测永远不让调用方失败。
// 单元从 <部署根>/current 拉起，那条路径是软链，所以判断必须比真实路径，
// 否则探测会一声不吭地什么都不做，日志空白、退出码 0，页面永远停在 unknown。
if (invokedDirectly(import.meta.url)) {
  await main();
  process.exit(0);
}
