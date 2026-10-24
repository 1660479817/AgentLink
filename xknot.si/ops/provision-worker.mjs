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
//   XKNOT_AFTER_ACTIVATE  可选：改为 active 之后执行的脚本绝对路径（例如重建门户）
//
// 运行方式见 ops/xknot-provision.service。

import { spawn } from "node:child_process";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as dns } from "node:dns";

import { markActive, markRosterLive, publishInstance } from "../server/publish.mjs";
import { notifyLive } from "./notify-live.mjs";
import { openStore } from "../server/store.mjs";
import { collectPeers } from "./peers.mjs";
import { resolveLocations } from "./geoip.mjs";
import { refreshStatus } from "./node-status.mjs";
import {
  ProvisionError,
  createRun,
  keyChanged,
  pendingStep,
  reconcileTunnel,
  refreshKeySteps,
  runStep,
  stepDone,
  stepFailed,
  stepRetry,
  switchEntry,
  tunnelFor,
} from "../server/provision.mjs";
import { probe } from "./check-health.mjs";
import { isTunnelAccount } from "./validate-federation.mjs";

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
// 接通后的可选钩子。读一次就定下来，执行处只按参数数组跑（见 advance）。
const afterActivate = String(process.env.XKNOT_AFTER_ACTIVATE || "").trim();
// 位置采集比接通慢得多：机器搬家不是秒级事件，而 ss/ps 每次要起两个进程。
const peerIntervalMs = Math.max(Number(process.env.XKNOT_PEER_INTERVAL_MS) || 60_000, 10_000);
const peersFile = path.join(dataDir, "peers.json");
const geoDir = path.join(dataDir, "geoip");

const store = openStore(path.join(dataDir, "xknot.db"));

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

// 「入口 conf 由外部管理」每个实例只说一次：这轮核对每 20 秒跑一遍，
// 每次都打一行会把 journal 刷满，而这件事本身不变化。
const externalNoted = new Set();
function noteExternal(instanceId, where) {
  if (externalNoted.has(instanceId)) return;
  externalNoted.add(instanceId);
  log(`${instanceId}: 入口 conf 由伙伴自己管理（${where}），中枢不覆盖；隧道与健康照常采集`);
}

// 门户是静态快照：把 status 改成 active 只是改了清单，卡片要等 data/hub.json 重算。
// 不在这里重算，节点就会一直「在线但首页没有它」，直到有人手工构建一次。
// 用子进程跑，不阻塞轮询；失败只留一行日志，xknot-republish.timer 会补。
let portalChild = null;
export function refreshPortal({ execPath = process.execPath, script = path.join(here, "republish.mjs") } = {}) {
  if (portalChild) return; // 同一轮里接通多个节点时，跑一次就够
  const child = spawn(execPath, [script, "--quiet"], { cwd: root, stdio: "inherit" });
  portalChild = child;
  child.on("close", (code) => {
    portalChild = null;
    log(code === 0 ? "门户快照已重算" : `门户快照重算失败（退出码 ${code}），等定时任务补`);
  });
  child.on("error", (error) => {
    portalChild = null;
    log(`门户快照重算无法启动：${error.message}`);
  });
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
    // 先 tee 再 chmod 的话，600 的目标会有一小段时间按 tee 的 umask 落在 644，
    // 凭据文件在那个窗口里是他人可读的。让远端 shell 自己设 umask，文件从创建起就收紧；
    // 文件名作为位置参数传给 sh，不拼进命令串。
    const written = await sudo(["sh", "-c", 'umask 077; cat > "$0"', file], { input: text });
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
  // 探测走 fetch-guard 时要一份「全部地址」：只查 A 记录会漏掉只有 AAAA 的实例，
  // 也会让地址校验拿不到完整的解析结果。
  async resolveAll(hostname) {
    const settled = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
    const addresses = [];
    for (const item of settled) {
      if (item.status === "fulfilled") addresses.push(...item.value);
    }
    return addresses;
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
    let again = await markActive({ manifestFile, id: run.instanceId });
    if (again.changed) {
      log(`${run.instanceId}: 清单被覆盖回 pending，已改回 active`);
      // 快照可能已经按 pending 重算过一遍（门户上少了一条），同样要补回来。
      refreshPortal();
    }
    // 覆盖有时是整条消失（仓库那份清单里还没有这个节点）。接通记录还在，
    // 就按它把清单与名册补回去；否则下一次改清单的动作会把这个节点彻底弄丢。
    if (again.error === "not_listed") {
      const application = store.getApplication(run.applicationId);
      if (application) {
        const restored = await publishInstance({
          application,
          tunnelAccount: run.account,
          tunnelPort: run.port,
          manifestFile,
          rosterFile,
        });
        if (restored.error) {
          log(`${run.instanceId}: 清单条目已丢失，补回失败 ${restored.error}`);
        } else {
          again = await markActive({ manifestFile, id: run.instanceId });
          log(`${run.instanceId}: 清单条目已丢失，按接通记录补回（${again.changed ? "active" : again.error || "未变更"}）`);
          store.recordEvent("instance.manifest_restored", run.instanceId, null);
        }
      }
    }
    try {
      const conf = await switchEntry({ host, run, entry: true });
      if (conf.changed) log(`${run.instanceId}: 入口已切回整站反代`);
      else if (conf.external) noteExternal(run.instanceId, "整站反代核对");
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

    // 端口按当前名册重算，而不是沿用 run 里上次分配的值：名册才是权威。
    // 同一轮里两条新申请会算进同一个最小空闲端口，先落盘的那个占住它；
    // 后者若继续信旧值，每轮发布都被判重复，永远停在 roster_invalid。
    const roster = await readJson(rosterFile, { members: [] });
    const current = reconcileTunnel({ run, members: roster.members || [] });
    if (current.account !== run.account || current.port !== run.port) {
      store.saveProvisionRun(current);
      log(`${run.instanceId}: 隧道参数按名册重算为 ${current.account} / ${current.port}`);
    }

    // 伙伴换了公钥：旧账号里的那份已经不匹配，从 account 起重跑一遍。
    if (keyChanged(current, application)) {
      const refreshed = refreshKeySteps(current, application);
      store.saveProvisionRun(refreshed);
      log(`${run.instanceId}: 公钥已更换，从 account 起重跑`);
      return refreshed;
    }

    const step = pendingStep(current);
    if (!step) {
      const next = { ...current, state: "awaiting_tunnel", lastError: null, updatedAt: new Date().toISOString() };
      store.saveProvisionRun(next);
      log(`${run.instanceId}: 入口侧已完成，等待隧道与探测`);
      return next;
    }

    try {
      const result = await runStep({
        step: step.id,
        run: current,
        application,
        host,
        entry: { adminEmail, entryHost },
        roster,
        publish: ({ application: app, tunnelAccount, tunnelPort }) =>
          publishInstance({ application: app, tunnelAccount, tunnelPort, manifestFile, rosterFile }),
      });
      const done = stepDone({ ...current, attempts: (current.attempts || 0) + 1 }, step.id, result?.note ?? null);
      store.saveProvisionRun(done);
      log(`${run.instanceId}: ${step.id} 完成${result?.note ? `（${result.note}）` : ""}`);
      return done;
    } catch (error) {
      const code = error instanceof ProvisionError ? error.code : "internal";
      const detail = error instanceof ProvisionError ? error.detail : error.message;
      log(`${run.instanceId}: ${step.id} 失败 ${code}${detail ? ` — ${detail}` : ""}`);
      // 失败留在原地，下一轮重试；面板上同时保留错误码，不用等重试成功才知道卡在哪。
      const next = stepRetry({ ...current, attempts: (current.attempts || 0) + 1 }, step.id, code);
      store.saveProvisionRun(next);
      return next;
    }
  }

  if (run.state === "awaiting_tunnel") {
    const target = `https://${run.host}/api/health`;
    // 与健康巡检同一条守卫：不传 resolve 就只按主机名请求，私网/回环地址直接放过去。
    const result = await probe(target, { timeoutMs: probeTimeoutMs, resolve: host.resolveAll });
    if (result.status === "up" || result.status === "degraded") {
      // 先把首页从占位页切成整站反代，再对外报 active：
      // 顺序反过来会出现「清单是 active、打开还是占位页」。
      try {
        const conf = await switchEntry({ host, run, entry: true });
        if (conf.changed) log(`${run.instanceId}: 隧道已通，首页改为整站反代`);
        else if (conf.external) noteExternal(run.instanceId, "接通时");
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
        // 清单被改成 suspended / retired 时不覆盖它：那是运营的决定，
        // 记一条事件让控制台看得到，而不是留一份「接通完成但没上架」的静默状态。
        store.recordEvent("instance.activate_refused", run.instanceId, activated.error);
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
      // 名册里那句「等待接通验收」现在成了假话，顺手换掉；运营手写过的备注不动。
      try {
        const roster = await markRosterLive({ rosterFile, id: run.instanceId });
        if (roster.changed) log(`${run.instanceId}: 名册备注已改为已接通`);
        else if (roster.error) log(`${run.instanceId}: 名册备注未更新 ${roster.error}`);
      } catch (error) {
        log(`${run.instanceId}: 名册备注未更新 ${error.message}`);
      }
      // 清单变了，门户快照也得跟着变，否则节点「在线但首页没有卡片」。
      refreshPortal();
      // 伙伴等的是「你的站已经通了」。这封信以前只能手打，现在接在验收上。
      try {
        const sent = await notifyLive({
          store,
          application: store.getApplication(run.applicationId),
        });
        if (sent.sent) log(`${run.instanceId}: 已上线通知已发给伙伴`);
        else if (sent.skipped === "already_sent") log(`${run.instanceId}: 已上线通知此前发过，不重发`);
        else if (sent.skipped === "no_smtp") log(`${run.instanceId}: 没有 SMTP 配置，已上线通知未发（配置后手工补发）`);
        else log(`${run.instanceId}: 已上线通知未发 ${sent.skipped || sent.failed}`);
      } catch (error) {
        log(`${run.instanceId}: 已上线通知发送异常 ${error.message}`);
      }
      if (afterActivate) {
        // 值来自 root 的 provision.env；交给 /bin/sh -c 就等于把那个文件的写权限
        // 变成 root 命令执行。只接受一个绝对路径，按参数数组执行，不经 shell 解析。
        if (!/^\/[A-Za-z0-9._/-]+$/.test(afterActivate)) {
          log("after-activate 跳过：只接受绝对路径，不能带空格或 shell 元字符");
        } else {
          const hook = spawn("/bin/sh", [afterActivate], { cwd: root, stdio: "inherit" });
          hook.on("close", (code) => log(`after-activate 退出码 ${code}`));
        }
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
  // 同一轮里连续建几条 run 时，前一条的端口还没写进名册；本轮已分出去先记下，
  // 后一条才不会拿到同一个。
  const reserved = [];
  for (const application of store.applicationsAwaitingProvision()) {
    const instanceId = application.subdomain || "";
    if (!instanceId) continue;
    const tunnel = tunnelFor({ instanceId, members: roster.members || [], reserved });
    // 名册手写条目的第二道闸：写入时校验过，读出来再用一次，别只信文件内容。
    if (!isTunnelAccount(tunnel.account)) {
      log(`${instanceId}: 名册里的隧道账号 ${tunnel.account} 不可用，跳过（只接受 knot-tunnel 命名）`);
      continue;
    }
    reserved.push(tunnel.port);
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
