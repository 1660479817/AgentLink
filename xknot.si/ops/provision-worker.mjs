#!/usr/bin/env node
// 自动接通常驻进程：把「已通过、已交公钥」的申请一路做到 /api 可用。
//
// 中枢不能拨进成员实例（对方在 NAT 后），所以这里只做入口主机这一侧：
// 账号、公钥、sshd、静态页、DNS 检查、nginx、证书。做完之后等对方把隧道起来，
// 探测 https://<子域>/api/health 通过，再把清单里的 status 从 pending 改成 active。
//
// 每一步都幂等，失败只记错误码并留在原地，下一轮重试。
// 配置（不写死在仓库里）：
//   XKNOT_ENTRY_HOST   入口主机的公网地址，写在 var/provision.env
//   XKNOT_ADMIN_EMAIL  证书登记邮箱，读 mail.env
//   XKNOT_PROVISION_INTERVAL_MS  轮询间隔，默认 20000
//   XKNOT_AFTER_ACTIVATE  可选：改为 active 之后执行的命令（例如重建门户）
//
// 运行方式见 ops/xknot-provision.service。

import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";

import { markActive, publishInstance } from "../server/publish.mjs";
import { openStore } from "../server/store.mjs";
import { collectPeers } from "./peers.mjs";
import { resolveLocations } from "./geoip.mjs";
import { refreshStatus } from "./node-status.mjs";
import {
  ProvisionError,
  createRun,
  keyChanged,
  pendingStep,
  refreshKeySteps,
  runStep,
  stepDone,
  stepFailed,
  stepRetry,
  switchEntry,
  tunnelFor,
} from "../server/provision.mjs";
import { probe } from "./check-health.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dataDir = process.env.XKNOT_DATA_DIR || path.join(root, "var");
const manifestFile = process.env.XKNOT_INSTANCES_FILE
  ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
  : path.join(root, "instances.json");
const rosterFile = process.env.XKNOT_FEDERATION_FILE
  ? path.resolve(process.env.XKNOT_FEDERATION_FILE)
  : path.join(root, "federation.json");
const entryHost = String(process.env.XKNOT_ENTRY_HOST || "").trim();
const adminEmail = String(process.env.XKNOT_ADMIN_EMAIL || "").trim();
const intervalMs = Math.max(Number(process.env.XKNOT_PROVISION_INTERVAL_MS) || 20_000, 5_000);
const probeTimeoutMs = 8000;
// 位置采集比接通慢得多：机器搬家不是秒级事件，而 ss/ps 每次要起两个进程。
const peerIntervalMs = Math.max(Number(process.env.XKNOT_PEER_INTERVAL_MS) || 60_000, 10_000);
const peersFile = path.join(dataDir, "peers.json");
const geoDir = path.join(dataDir, "geoip");

const store = openStore(path.join(dataDir, "xknot.db"));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// ---- 入口主机：只走参数数组，不经 shell ----

export function sudo(argv, { input = null, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn("sudo", ["-n", ...argv], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

const host = {
  sudo,
  async readRootFile(file) {
    const result = await sudo(["cat", file]);
    return result.code === 0 ? result.stdout : null;
  },
  async writeRootFile(file, text, mode = "644", { owner = null } = {}) {
    const written = await sudo(["tee", file], { input: text });
    if (written.code !== 0) throw new ProvisionError("write_failed", written.stderr);
    if (owner) await sudo(["chown", owner, file]);
    await sudo(["chmod", mode, file]);
  },
  async resolve4(hostname) {
    try {
      return await dns.resolve4(hostname);
    } catch {
      return [];
    }
  },
};

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

// ---- 站点位置：来自隧道对端，不看自述区 ----
//
// 实例在 NAT 后面，位置只能从「它连出来的那条连接」看出。入口主机与中枢是
// 同一台机器，所以这里直接读 sshd 的 socket 对端地址，再查一次 GeoIP。
// 见 ops/peers.mjs 与 ops/geoip.mjs。
//
// 读不到就保留上一份，不写空结果：一次 sudo 抖动不该把已知位置抹掉。
let peerAt = 0;
let peerError = "";
async function refreshPeers() {
  const now = Date.now();
  if (now - peerAt < peerIntervalMs) return;
  peerAt = now;

  const roster = await readJson(rosterFile, { members: [] });
  const result = await collectPeers({ members: roster.members || [] });
  if (result.error) {
    if (result.error !== peerError) {
      peerError = result.error;
      log(`位置采集跳过：${result.error} ${result.detail || ""}`.trim());
    }
    return;
  }
  peerError = "";
  await writeJson(peersFile, { collectedAt: new Date().toISOString(), peers: result.peers });
  try {
    const located = await resolveLocations({ dir: geoDir, peers: result.peers });
    if (located.error) log(`位置解析失败：${located.error}`);
    else if (located.resolved) log(`位置：新解析 ${located.resolved} 个地址`);
  } catch (error) {
    log(`位置写入失败：${error.message}`);
  }
  // 隧道与位置都是节点状态的一部分：采完就重算一次。
  try {
    await refreshStatus({ dataDir, instancesPath: manifestFile, federationPath: rosterFile });
  } catch (error) {
    log(`节点状态未更新：${error.message}`);
  }
}

export async function advance(run) {
  // 已经验收的：确认清单仍是 active，并核对入口 conf 还在「整站反代」状态。
  // deploy-api.sh 会把仓库里的 instances.json 同步上来，那里可能还是 pending；
  // 接通是既成事实，以 provision_runs 为准，顺手改回来即可。
  if (run.state === "active") {
    const again = await markActive({ manifestFile, id: run.instanceId });
    if (again.changed) log(`${run.instanceId}: 清单被覆盖回 pending，已改回 active`);
    try {
      const conf = await switchEntry({ host, run, entry: true });
      if (conf.changed) log(`${run.instanceId}: 入口已切回整站反代`);
    } catch (error) {
      log(`${run.instanceId}: 入口 conf 核对失败 ${error.code || error.message}`);
    }
    return run;
  }
  if (run.state === "failed") return run;

  if (run.state === "provisioning") {
    const application = store.getApplication(run.applicationId);
    if (!application || application.status !== "approved") {
      const next = { ...run, state: "failed", lastError: "application_closed" };
      store.saveProvisionRun(next);
      return next;
    }

    // 伙伴换了公钥：旧账号里的那份已经不匹配，从 account 起重跑一遍。
    if (keyChanged(run, application)) {
      const refreshed = refreshKeySteps(run, application);
      store.saveProvisionRun(refreshed);
      log(`${run.instanceId}: 公钥已更换，从 account 起重跑`);
      return refreshed;
    }

    const step = pendingStep(run);
    if (!step) {
      const next = { ...run, state: "awaiting_tunnel", lastError: null, updatedAt: new Date().toISOString() };
      store.saveProvisionRun(next);
      log(`${run.instanceId}: 入口侧已完成，等待隧道与探测`);
      return next;
    }

    const roster = await readJson(rosterFile, { members: [] });

    try {
      const result = await runStep({
        step: step.id,
        run,
        application,
        host,
        entry: { adminEmail, entryHost },
        roster,
        publish: ({ application: app, tunnelAccount, tunnelPort }) =>
          publishInstance({ application: app, tunnelAccount, tunnelPort, manifestFile, rosterFile }),
      });
      const done = stepDone({ ...run, attempts: (run.attempts || 0) + 1 }, step.id, result?.note ?? null);
      store.saveProvisionRun(done);
      log(`${run.instanceId}: ${step.id} 完成${result?.note ? `（${result.note}）` : ""}`);
      return done;
    } catch (error) {
      const code = error instanceof ProvisionError ? error.code : "internal";
      const detail = error instanceof ProvisionError ? error.detail : error.message;
      log(`${run.instanceId}: ${step.id} 失败 ${code}${detail ? ` — ${detail}` : ""}`);
      // 失败留在原地，下一轮重试；面板上同时保留错误码，不用等重试成功才知道卡在哪。
      const next = stepRetry({ ...run, attempts: (run.attempts || 0) + 1 }, step.id, code);
      store.saveProvisionRun(next);
      return next;
    }
  }

  if (run.state === "awaiting_tunnel") {
    const target = `https://${run.host}/api/health`;
    const result = await probe(target, { timeoutMs: probeTimeoutMs });
    if (result.status === "up" || result.status === "degraded") {
      // 先把首页从占位页切成整站反代，再对外报 active：
      // 顺序反过来会出现「清单是 active、打开还是占位页」。
      try {
        const conf = await switchEntry({ host, run, entry: true });
        if (conf.changed) log(`${run.instanceId}: 隧道已通，首页改为整站反代`);
      } catch (error) {
        const code = error instanceof ProvisionError ? error.code : "entry_switch_failed";
        log(`${run.instanceId}: 切换整站反代失败 ${code}，下一轮重试`);
        // 不把 tls 标成 pending：证书那一步确实做完了，卡住的是切换。
        // 只留 lastError 让面板标红，下一轮自动重试。
        const next = { ...run, lastError: code, updatedAt: new Date().toISOString() };
        store.saveProvisionRun(next);
        return next;
      }
      const activated = await markActive({ manifestFile, id: run.instanceId });
      if (activated.error) {
        const next = { ...stepFailed(run, "activate", activated.error), state: "failed" };
        store.saveProvisionRun(next);
        return next;
      }
      const next = {
        ...run,
        state: "active",
        tunnelConfirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.saveProvisionRun(next);
      store.recordEvent("instance.active", run.instanceId, null);
      log(`${run.instanceId}: /api/health 通过，清单已改为 active`);
      if (process.env.XKNOT_AFTER_ACTIVATE) {
        const hook = spawn("/bin/sh", ["-c", process.env.XKNOT_AFTER_ACTIVATE], { cwd: root, stdio: "inherit" });
        hook.on("close", (code) => log(`after-activate 退出码 ${code}`));
      }
      return next;
    }
    return run;
  }

  return run;
}

async function tick() {
  // 位置采集与接通互不依赖：入口主机配置缺失时也要更新页面上的区域。
  await refreshPeers();

  if (!entryHost || !adminEmail) {
    log("缺少 XKNOT_ENTRY_HOST / XKNOT_ADMIN_EMAIL，自动接通不启动");
    return;
  }

  const roster = await readJson(rosterFile, { members: [] });
  for (const application of store.applicationsAwaitingProvision()) {
    const instanceId = application.subdomain || "";
    if (!instanceId) continue;
    const tunnel = tunnelFor({ instanceId, members: roster.members || [] });
    const run = store.createProvisionRun(createRun({ application, tunnel, entryHost }));
    log(`${instanceId}: 新建接通任务 ${application.id}（${tunnel.account} / ${tunnel.port}）`);
    if (run) await advance(run);
  }

  for (const run of store.listProvisionRuns(20)) {
    await advance(run);
  }
}

async function main() {
  log(`provision worker 启动：entry=${entryHost || "（未配置）"} 间隔 ${intervalMs}ms`);
  // 常驻循环；单轮异常不能把进程带走，否则一次 DNS 抖动要等 systemd 重启。
  for (;;) {
    try {
      await tick();
    } catch (error) {
      log(`轮询出错：${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

// 直接运行时才进循环；被测试 import 时只提供 advance()。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
