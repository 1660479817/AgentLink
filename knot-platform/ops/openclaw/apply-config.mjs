import { execFileSync } from "node:child_process";
import { access, chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
const configPath = path.join(stateDir, "openclaw.json");
const snapshotPath = path.join(stateDir, "knot-config-snapshot.json");
const promptFiles = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"];
const identityLabels = new Set(["name", "creature", "vibe", "emoji", "avatar", "theme"]);

// 去掉标题后还要有正文。可以短，不能只剩标题或空白。
export function promptBody(text) {
  return String(text).replace(/^\uFEFF/, "").replace(/^#[^\n]*\n?/, "").trim();
}

// OpenClaw 只认 `- **Name:**` 这一类行，中文标签会被忽略。
export function identityFields(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^\s*-\s*/, "");
    const colon = cleaned.indexOf(":");
    if (colon === -1) continue;
    const label = cleaned.slice(0, colon).replace(/[*_`]/g, "").trim().toLowerCase();
    const value = cleaned.slice(colon + 1).replace(/^[*_`\s]+|[*_`\s]+$/g, "").trim();
    if (!value || !identityLabels.has(label)) continue;
    fields[label] = value;
  }
  return fields;
}

export function soulReady(text) {
  return Boolean(promptBody(text)) && ["Core Truths", "Boundaries", "Vibe"].every((heading) => new RegExp(`^##\\s+${heading}\\s*$`, "m").test(text));
}

export function userReady(text) {
  const stamp = /<!--\s*observed:\s*\d{4}-\d{2}-\d{2}\s*\|\s*status:\s*(?:active|superseded)\s*-->/;
  const imperative = /^[-*]\s+(?:Always|Never|Prefer)\b/m;
  return stamp.test(text) && imperative.test(text);
}

async function readPrompt(dir, name) {
  try {
    return await readFile(path.join(dir, name), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error(`缺少 ${name}：${dir}`);
    throw error;
  }
}

export async function assertPrompts(dir) {
  const identity = await readPrompt(dir, "IDENTITY.md");
  const fields = identityFields(identity);
  if (!fields.name || !fields.vibe) throw new Error(`IDENTITY.md 缺少 Name 或 Vibe：${dir}`);
  if (!soulReady(await readPrompt(dir, "SOUL.md"))) throw new Error(`SOUL.md 不合格式：${dir}`);
  if (!userReady(await readPrompt(dir, "USER.md"))) throw new Error(`USER.md 不合格式：${dir}`);
}

export function visibleSkills(manifest, agent) {
  if (agent.common === false) return [...agent.skills];
  return [...manifest.commonSkills, ...agent.skills];
}

// 无扩展名的文件是可执行命令（admin、read、actuary），同目录的 .mjs 是它的实现。
// 测试文件不复制。
function isCommand(name) {
  return !name.includes(".");
}

export function skillSources(names) {
  return names.filter((name) => name === "SKILL.md" || isCommand(name) || (name.endsWith(".mjs") && !name.endsWith(".test.mjs")));
}

export function toolSources(names) {
  return names.filter((name) => isCommand(name) || (name.endsWith(".mjs") && !name.endsWith(".test.mjs")));
}

export function patchConfig(config, manifest) {
  const next = structuredClone(config);
  next.agents ??= {};
  next.agents.entries ??= {};
  for (const agent of manifest.agents) {
    const entry = next.agents.entries[agent.id];
    if (!entry) continue;
    entry.skills = visibleSkills(manifest, agent);
    entry.subagents = { ...(entry.subagents || {}), allowAgents: [...agent.allowAgents] };
  }
  return next;
}

const INTERNAL_ID = /^[a-z][a-z0-9-]{0,39}$/;

export function internalAgentIds(names) {
  return names.filter((name) => INTERNAL_ID.test(name) && !name.startsWith("knot-")).sort();
}

// 平台管理 Agent 一律以 knot- 开头（knot-intel / knot-admin / knot-actuary）。从 manifest
// 里移除一个之后，已经在跑的那台机器上那条 entry 不会自己消失：它仍留在 openclaw.json、
// 仍占着工作区与 agent 目录，`patchConfig` 只更新 manifest 里还有的那些。这里把「本机有、
// manifest 已经没有」的列出来，交给 ensure-openclaw 用 `openclaw agents delete` 连工作区
// 一起收掉——下线与上线走同一条部署路径，而不是留给人去记得手工清理。
export function retiredAgentIds(config, manifest) {
  const live = new Set((manifest?.agents || []).map((agent) => agent.id));
  return Object.keys(config?.agents?.entries || {})
    .filter((id) => id.startsWith("knot-") && !live.has(id))
    .sort();
}

export function patchInternal(config, ids) {
  const next = structuredClone(config);
  next.agents ??= {};
  next.agents.entries ??= {};
  for (const id of ids) {
    const entry = next.agents.entries[id];
    if (!entry) continue;
    entry.skills = [];
    // 签发出来的内部 Agent 默认不互相委派。「其余全部」等于给每个新账户开一道口子，
    // 而它们各有各的令牌与工作区。要委派就在 internal_agent/<id>/ 里显式声明。
    entry.subagents = { ...(entry.subagents || {}), allowAgents: [] };
  }
  return next;
}

async function readManifest() {
  return JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
}

async function readInternalIds() {
  const dir = path.join(root, "internal_agent");
  let names = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    names = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return internalAgentIds(names);
}

async function agentSource(id) {
  const manifest = await readManifest();
  if (manifest.agents.some((agent) => agent.id === id)) return path.join(root, "agents", id);
  const internal = path.join(root, "internal_agent", id);
  try {
    await access(internal);
    return internal;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  throw new Error(`unknown agent ${id}`);
}

async function seedPrompts(id) {
  const source = await agentSource(id);
  await assertPrompts(source);
  const workspace = path.join(stateDir, `workspace-${id}`);
  await mkdir(workspace, { recursive: true });
  for (const name of promptFiles) {
    await copyFile(path.join(source, name), path.join(workspace, name));
  }
  await rm(path.join(workspace, "BOOTSTRAP.md"), { force: true });
}

// 授权码文件名默认是 `<id>.local.env`。两个称呼撞成同一个文件名时，
// ensure-internal-agent 会写成 `<id>.<uuid 前 8 位>.local.env`，这里两种都认。
async function agentEnvFile(dir, id) {
  const names = await readdir(dir).catch(() => []);
  const spare = names
    .filter((name) => name.startsWith(`${id}.`) && name.endsWith(".local.env"))
    .sort();
  const preferred = names.includes(`${id}.local.env`) || !spare.length ? `${id}.local.env` : spare[0];
  return path.join(dir, preferred);
}

async function syncInternal(ids) {
  for (const id of ids) {
    const source = path.join(root, "internal_agent", id);
    const workspace = path.join(stateDir, `workspace-${id}`);
    await mkdir(workspace, { recursive: true });
    await assertPrompts(source);
    for (const name of promptFiles) {
      await copyFile(path.join(source, name), path.join(workspace, name));
    }
    await rm(path.join(workspace, "BOOTSTRAP.md"), { force: true });
    // root 是 ops/openclaw，部署根在它的两级之上：<部署根>/sites/<站点>/agents。
    // 少一层会落到 <部署根>/ops/sites，读不到就把 ENOENT 吞掉，同步照样报成功。
    const envDir =
      process.env.KNOT_AGENT_ENV_DIR || path.join(root, "..", "..", "sites", process.env.KNOT_SITE || "", "agents");
    const envFile = await agentEnvFile(envDir, id);
    const tokenFile = path.join(workspace, ".knot-agent.env");
    try {
      await copyFile(envFile, tokenFile);
      await chmod(tokenFile, 0o600);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // 没有授权码时这个 Agent 调不了接口。别静默：运维看到的「同步成功」会骗人。
      console.error(`警告：没有 ${envFile}，${id} 这次没有 .knot-agent.env（先用 ensure-internal-agent.sh 签发）。`);
    }
  }
}

async function readConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

async function writeConfig(config) {
  const tmp = `${configPath}.knot-tmp`;
  // 这份配置里有 gateway/auth 等本机凭据。临时文件必须一开始就是 0600：
  // 先按缺省权限写、再 rename，会把整份配置的权限降成 0644。
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, configPath);
  // 目标文件可能本来就在、权限更宽；rename 保留的是临时文件的权限，这里再对一次。
  await chmod(configPath, 0o600);
}

async function snapshot() {
  const config = await readConfig();
  const saved = {
    bindings: config.bindings ?? [],
    talk: config.talk ?? null,
    systemAgent: config.agents?.defaults?.systemAgent ?? null,
    heartbeat: config.agents?.defaults?.heartbeat ?? null,
  };
  await writeFile(snapshotPath, `${JSON.stringify(saved)}\n`);
}

async function restore(config) {
  let raw;
  try {
    raw = await readFile(snapshotPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return config;
    throw error;
  }
  const saved = JSON.parse(raw);
  config.bindings = saved.bindings;
  if (saved.talk == null) delete config.talk;
  else config.talk = saved.talk;
  config.agents ??= {};
  config.agents.defaults ??= {};
  if (saved.systemAgent == null) delete config.agents.defaults.systemAgent;
  else config.agents.defaults.systemAgent = saved.systemAgent;
  if (saved.heartbeat == null) delete config.agents.defaults.heartbeat;
  else config.agents.defaults.heartbeat = saved.heartbeat;
  return config;
}

async function syncTools(agentId) {
  const source = path.join(root, "agents", agentId, "tools");
  let names = [];
  try {
    names = toolSources(await readdir(source));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!names.length) return;
  const destDir = path.join(stateDir, `workspace-${agentId}`, "tools");
  await mkdir(destDir, { recursive: true });
  for (const name of names) {
    const dest = path.join(destDir, name);
    await copyFile(path.join(source, name), dest);
    if (isCommand(name)) await chmod(dest, 0o755);
  }
}

async function sync() {
  const manifest = await readManifest();
  for (const agent of manifest.agents) {
    const source = path.join(root, "agents", agent.id);
    const workspace = path.join(stateDir, `workspace-${agent.id}`);
    await mkdir(workspace, { recursive: true });
    await assertPrompts(source);
    for (const name of promptFiles) {
      await copyFile(path.join(source, name), path.join(workspace, name));
    }
    await rm(path.join(workspace, "BOOTSTRAP.md"), { force: true });
    const ordersSource = path.join(root, "agents", agent.id, "ORDERS.md");
    const ordersDest = path.join(workspace, "ORDERS.md");
    try {
      await access(ordersSource);
      try {
        await access(ordersDest);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        await copyFile(ordersSource, ordersDest);
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await syncTools(agent.id);
    for (const skill of visibleSkills(manifest, agent)) {
      const sourceDir = path.join(root, "skills", skill);
      const destDir = path.join(workspace, "skills", skill);
      await mkdir(destDir, { recursive: true });
      const names = skillSources(await readdir(sourceDir));
      if (!names.includes("SKILL.md")) throw new Error(`missing SKILL.md for ${skill}`);
      for (const name of names) {
        const dest = path.join(destDir, name);
        await copyFile(path.join(sourceDir, name), dest);
        if (isCommand(name)) await chmod(dest, 0o755);
      }
    }
  }
  const internalIds = await readInternalIds();
  await syncInternal(internalIds);
  let config = await restore(await readConfig());
  config = patchConfig(config, manifest);
  config = patchInternal(config, internalIds);
  await writeConfig(config);
  await rm(snapshotPath, { force: true });
}

// ---- 同步状态文件 ----
// 这次同步的「意图」：哪些 Agent 该在、各自看哪些技能、巡查任务叫什么。
// 运行时拿它和本机实际注册的比，才能区分「掉了」和「故意下线」——
// 这两种情况从 `openclaw agents list` 上看完全一样。
export function renderSyncReport({ syncedAt, version, gatewayPort, patrolCron, manifest: source } = {}) {
  const agents = [];
  const skills = {};
  for (const agent of source?.agents || []) {
    if (!agent?.id) continue;
    agents.push(agent.id);
    skills[agent.id] = visibleSkills(source, agent);
  }
  const port = Number(gatewayPort);
  return {
    syncedAt: syncedAt || new Date().toISOString(),
    openclawVersion: version || null,
    gatewayPort: Number.isFinite(port) ? port : null,
    agents,
    skills,
    patrolCron: patrolCron || null,
  };
}

// 与 openclawStatus.js 同一个推法：部署根由 site-config.sh 导出，
// 推不出来就不写——不猜路径，也不在代码目录里造一个 var/run。
export function reportFilePath(env = process.env) {
  const root = String(env.KNOT_DEPLOY_ROOT || "").trim();
  return root ? path.join(root, "var", "run", "openclaw-sync.json") : null;
}

// 原子写：先写临时文件再 rename。半份 JSON 比没有文件更糟——
// 读者会把残文件当成「同步过但内容不明」，而不是「这次没同步」。
export async function writeSyncReport(file, report) {
  if (!file) throw new Error("缺少部署根，写不了状态文件");
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, file);
  return file;
}

function detectOpenclawVersion() {
  try {
    const out = execFileSync("openclaw", ["--version"], { encoding: "utf8" });
    return (out.match(/\d{4}\.\d+\.\d+/) || [null])[0];
  } catch {
    return null;
  }
}

// ---- main 的部署说明 ----
// OpenClaw 的 main 是它自己的默认 Agent，不是 Knot 的组件。这里只往它的工作区放
// 两份说明：一份我们拥有的 KNOT.md，一份 AGENTS.md 里受控的一段。不碰 channels、
// auth、gateway 与 onboarding，也不整份覆盖 AGENTS.md——那是主人自己写的东西。

const BRIEF_BEGIN = "<!-- knot:begin -->";
const BRIEF_END = "<!-- knot:end -->";
const BRIEF_REGION = /<!--\s*knot:begin\s*-->[\s\S]*?<!--\s*knot:end\s*-->/;

export function briefBlock() {
  return [
    BRIEF_BEGIN,
    "## Knot",
    "Read KNOT.md in this workspace: it maps the deployment root, where code, config,",
    "data and logs live, and which read-only commands are safe. You do not administer",
    "the site; knot-admin does. You are a side path: if you are down the site still runs.",
    BRIEF_END,
  ].join("\n");
}

// 有标记就换标记区，没有就追加一次。标记随块一起写进去，所以第二次运行走的是替换，
// 不会越叠越长。
export function patchAgentsBrief(existing, block = briefBlock()) {
  const text = String(existing ?? "");
  if (BRIEF_REGION.test(text)) return text.replace(BRIEF_REGION, block);
  if (!text.trim()) return `${block}\n`;
  return `${text.replace(/\s*$/, "")}\n\n${block}\n`;
}

// 部署根、站点与端口都是同步时已有的取值。缺哪个就写「未配置」，
// 让读到的人知道是没传，而不是这条路径不存在。
export function renderBrief({ deployRoot = "", site = "", stateDir = "", port = "" } = {}) {
  const root = String(deployRoot || "").trim() || "(not configured)";
  const name = String(site || "").trim() || "(not configured)";
  const state = String(stateDir || "").trim() || "(not configured)";
  const gateway = Number(port);
  const lines = [
    "# Knot — how this machine is laid out",
    "",
    "Written by the deployment on every sync. Paths and commands only: no token,",
    "no key, no private address. If this file is stale, the deployment did not run.",
    "",
    "## 1. Where things are",
    "",
    `- Deploy root: \`${root}\``,
    `- Running release: \`${root}/current\` (a symlink into \`releases/\`)`,
    `- Every release: \`${root}/releases/\``,
    `- Site config: \`${root}/sites/${name}/\` — outside the release, so upgrades and rollbacks leave it alone`,
    `- Uploads: \`${root}/var/uploads/\``,
    `- Logs: \`${root}/var/log/*.log\``,
    `- Runtime state: \`${root}/var/run/*.json\``,
    `- Agent workspaces: \`${state}/workspace-*\``,
    "",
    "## 2. Read-only commands you may run",
    "",
    `- \`${root}/current/ops/scripts/doctor.sh --site ${name}\``,
    `- \`${root}/current/ops/scripts/openclaw-check.sh\``,
  ];
  if (Number.isFinite(gateway) && gateway > 0) lines.push(`- \`curl -s 127.0.0.1:${gateway}/api/health\``);
  lines.push(
    "- `openclaw agents list`",
    "- `openclaw gateway health`",
    "- `openclaw cron list`",
    "",
    "## 3. Do not",
    "",
    "- Read `platform.env`, `xknot.env`, `tunnel.env`, `agents/*.local.env`, `.admin-token`,",
    "  or `openclaw.json`. They hold credentials, and reading them is never the answer.",
    "- Run deploy, reset, restore or migration scripts. The deployment owns those.",
    "- Write to the database directly.",
    "- Delete posts or mute accounts on the owner's behalf.",
    "- Paste host paths or command output containing credentials into a chat.",
    "",
    "## 4. When something looks wrong",
    "",
    "- `502` from the site: check the entry tunnel, not this machine's app process.",
    "- Reviews not moving: the agents block in the admin console says whether that is",
    "  the reviewer or OpenClaw itself.",
    "- Before saying the site is down, read `/api/health`. The common mistake is",
    "  reporting a dead reviewer as a dead site: they are different failures.",
    ""
  );
  return lines.join("\n");
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// 工作区只认三处：entries 里写的、bindings 里写的、本机已经存在的 workspace-<id>。
// 不假设 workspace-main，也不替 OpenClaw 建目录——建出来的目录它未必认。
export async function resolveMainWorkspace({ config, stateDir: dir = stateDir, id = "main", exists = fileExists } = {}) {
  const declared = config?.agents?.entries?.[id]?.workspace;
  if (typeof declared === "string" && declared.trim()) return declared.trim();
  const binding = (config?.bindings || []).find((entry) => entry && entry.agentId === id);
  if (typeof binding?.workspace === "string" && binding.workspace.trim()) return binding.workspace.trim();
  const candidate = path.join(String(dir || ""), `workspace-${id}`);
  return (await exists(candidate)) ? candidate : null;
}

// 写 KNOT.md 与 AGENTS.md 的受控块。返回一份报告，交给调用方决定打什么日志。
// 任何一步的前提不成立都只是「跳过」，不是失败：这是旁路，部署不该为它停。
export async function writeMainBrief({ workspace, brief, block = briefBlock(), dryRun = false } = {}) {
  if (!workspace) return { ok: false, reason: "no_workspace" };
  const agentsPath = path.join(workspace, "AGENTS.md");
  const briefPath = path.join(workspace, "KNOT.md");
  const backupPath = `${agentsPath}.knot-before-brief`;
  const existing = await readFile(agentsPath, "utf8").catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const next = existing == null ? null : patchAgentsBrief(existing, block);
  const changed = next != null && next !== existing;
  const backup = changed && !(await fileExists(backupPath));
  const report = {
    ok: true,
    workspace,
    briefPath,
    agentsPath,
    agentsState: existing == null ? "missing" : changed ? "updated" : "current",
    backup: backup ? backupPath : null,
  };
  if (dryRun) return report;

  const tmpBrief = `${briefPath}.knot-tmp`;
  await writeFile(tmpBrief, brief, { mode: 0o644 });
  await rename(tmpBrief, briefPath);

  if (!changed) return report;
  if (backup) await copyFile(agentsPath, backupPath);
  // 只改受控块，权限沿用原文件：主人可能自己设过。
  const current = await stat(agentsPath);
  const tmpAgents = `${agentsPath}.knot-tmp`;
  await writeFile(tmpAgents, next, { mode: current.mode & 0o777 });
  await rename(tmpAgents, agentsPath);
  return report;
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const value = args[i + 1];
    if (value && !value.startsWith("--")) {
      flags[arg.slice(2)] = value;
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return flags;
}

const command = process.argv[2];
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const manifest = !isDirect || command === "patch-test" ? null : await readManifest();
if (isDirect && command === "ids") {
  process.stdout.write(`${manifest.agents.map((agent) => agent.id).join("\n")}\n`);
} else if (isDirect && command === "internal-ids") {
  const ids = await readInternalIds();
  process.stdout.write(ids.length ? `${ids.join("\n")}\n` : "");
} else if (isDirect && command === "snapshot") {
  await snapshot();
} else if (isDirect && command === "seed") {
  const id = process.argv[3];
  if (!id) {
    process.stderr.write("usage: apply-config.mjs seed <id>\n");
    process.exit(2);
  }
  await seedPrompts(id);
} else if (isDirect && command === "retired-ids") {
  const ids = retiredAgentIds(await readConfig(), manifest);
  process.stdout.write(ids.length ? `${ids.join("\n")}\n` : "");
} else if (isDirect && command === "sync") {
  await sync();
} else if (isDirect && command === "sync-report") {
  // 由 ensure-openclaw.sh 在巡查任务登记之后调用：那时它才真正知道该有什么。
  const flags = parseFlags(process.argv.slice(3));
  const file = reportFilePath();
  if (!file) {
    process.stderr.write("warn: 没有部署根，同步状态文件这次不写\n");
  } else {
    const report = renderSyncReport({
      version: flags.version || detectOpenclawVersion(),
      gatewayPort: flags.port,
      patrolCron: flags.patrol,
      manifest,
    });
    await writeSyncReport(file, report);
    process.stdout.write(`${file}\n`);
  }
} else if (isDirect && command === "main-brief") {
  // 由 ensure-openclaw.sh 在同步之后调用。可见地跑：日志里能看出写了什么、
  // 跳过了什么。读不到 openclaw.json 不算失败——工作区还有第三条线索。
  const flags = parseFlags(process.argv.slice(3));
  const deployRoot = String(process.env.KNOT_DEPLOY_ROOT || "").trim();
  if (!deployRoot) {
    // 没有部署根就整份不写：把「未配置」写进 KNOT.md，比留着一份旧的更糟。
    process.stderr.write("warn: 没有 KNOT_DEPLOY_ROOT，main 的说明这次不写\n");
  } else {
    const config = await readConfig().catch(() => null);
    const workspace = await resolveMainWorkspace({ config });
    const brief = renderBrief({
      deployRoot,
      site: process.env.KNOT_SITE || "",
      stateDir,
      port: flags.port || process.env.OPENCLAW_GATEWAY_PORT,
    });
    const report = await writeMainBrief({ workspace, brief, dryRun: Boolean(flags["dry-run"]) });
    if (!report.ok) {
      process.stderr.write("warn: 找不到 main 的工作区，KNOT.md 这次不写\n");
    } else if (report.agentsState === "missing") {
      process.stdout.write(`workspace: ${report.workspace}\nKNOT.md: ${report.briefPath}\n`);
      process.stderr.write("warn: 这个工作区没有 AGENTS.md，只写了 KNOT.md\n");
    } else {
      const backupNote = report.backup ? `（${flags["dry-run"] ? "将备份" : "备份"} ${report.backup}）` : "";
      process.stdout.write(
        `workspace: ${report.workspace}\nKNOT.md: ${report.briefPath}\n` +
          `AGENTS.md: ${report.agentsState}${backupNote}\n`
      );
    }
    if (flags["dry-run"] && report.ok) {
      process.stdout.write(`\n${brief}\n${briefBlock()}\n`);
    }
  }
} else if (isDirect && command === "patch-test") {
  const sample = {
    bindings: [{ agentId: "main" }],
    agents: { entries: { "knot-intel": { name: "knot-intel" }, "knot-admin": { name: "knot-admin" } } },
  };
  const patched = patchConfig(sample, {
    commonSkills: ["knot-employee"],
    agents: [
      { id: "knot-intel", skills: ["knot-intel"], allowAgents: [] },
      { id: "knot-admin", skills: ["knot-admin"], allowAgents: [], common: false },
      { id: "missing", skills: ["x"], allowAgents: [] },
    ],
  });
  const names = patched.agents.entries["knot-intel"].skills;
  if (names[0] !== "knot-employee" || names[1] !== "knot-intel") process.exit(1);
  if (patched.agents.entries["knot-intel"].subagents.allowAgents.length !== 0) process.exit(1);
  if (patched.agents.entries["knot-admin"].skills.join() !== "knot-admin") process.exit(1);
  if (patched.agents.entries.missing) process.exit(1);
  if (patched.bindings[0].agentId !== "main") process.exit(1);
  const copied = skillSources(["SKILL.md", "admin", "admin.mjs", "admin.test.mjs", "notes.txt"]);
  if (copied.join() !== "SKILL.md,admin,admin.mjs") process.exit(1);
  const tools = toolSources(["read", "read.mjs", "read.test.mjs", "notes.txt"]);
  if (tools.join() !== "read,read.mjs") process.exit(1);
  const actuary = skillSources(["SKILL.md", "actuary", "actuary.mjs", "notes.txt"]);
  if (actuary.join() !== "SKILL.md,actuary,actuary.mjs") process.exit(1);
  const internalIds = internalAgentIds(["finder", "knot-intel", "Bad Name", ""]);
  if (internalIds.join() !== "finder") process.exit(1);
  const block = briefBlock();
  if (patchAgentsBrief("前。\n", block) !== `前。\n\n${block}\n`) process.exit(1);
  if (patchAgentsBrief(patchAgentsBrief("前。\n", block), block) !== `前。\n\n${block}\n`) process.exit(1);
  const marked = patchAgentsBrief(`前。\n${block}\n后。\n`, "<!-- knot:begin -->\nX\n<!-- knot:end -->");
  if (!marked.includes("前。") || !marked.includes("后。") || !marked.includes("X")) process.exit(1);
  const brief = renderBrief({ deployRoot: "/srv/knot", site: "s", stateDir: "/h/.openclaw", port: 18789 });
  if (!brief.includes("/srv/knot/current") || !brief.includes("--site s") || !brief.includes("127.0.0.1:18789")) process.exit(1);
  if (renderBrief({}).includes("curl")) process.exit(1);
  const withInternal = patchInternal(
    { agents: { entries: { finder: { name: "finder" }, "knot-intel": { skills: ["knot-intel"] } } } },
    ["finder", "missing"]
  );
  if (withInternal.agents.entries.finder.skills.length !== 0) process.exit(1);
  if (withInternal.agents.entries.finder.subagents.allowAgents.join() !== "") process.exit(1);
  if (withInternal.agents.entries["knot-intel"].skills.join() !== "knot-intel") process.exit(1);
  if (withInternal.agents.entries.missing) process.exit(1);
  if (promptBody("# SOUL\n\n只报数字。") !== "只报数字。") process.exit(1);
  if (promptBody("# USER\n") !== "") process.exit(1);
  if (promptBody("   ") !== "") process.exit(1);
  if (promptBody("短。") !== "短。") process.exit(1);
  const named = identityFields("# IDENTITY.md\n\n- **Name:** 数据评审员\n- 名字：不会被认\n- **Vibe:** 短\n");
  if (named.name !== "数据评审员" || named.vibe !== "短" || named["名字"]) process.exit(1);
  if (!soulReady("# SOUL.md\n\n## Core Truths\n\n短。\n\n## Boundaries\n\n- 不猜。\n\n## Vibe\n\n短。\n")) process.exit(1);
  if (soulReady("# SOUL\n\n你是智能体。\n")) process.exit(1);
  if (!userReady("<!-- observed: 2026-10-16 | status: active -->\n\n- Always 交回 JSON。\n")) process.exit(1);
  if (userReady("# USER\n\n交回 JSON。\n")) process.exit(1);
  for (const id of ["knot-intel", "knot-admin", "knot-actuary"]) {
    await assertPrompts(path.join(root, "agents", id));
  }
  const emptyDir = path.join(os.tmpdir(), `knot-prompt-${process.pid}`);
  await mkdir(emptyDir, { recursive: true });
  try {
    await writeFile(path.join(emptyDir, "IDENTITY.md"), "# IDENTITY\n\n- 名字：数据评审员\n");
    await writeFile(path.join(emptyDir, "SOUL.md"), "# SOUL.md\n\n## Core Truths\n\n短。\n\n## Boundaries\n\n- 不猜。\n\n## Vibe\n\n短。\n");
    await writeFile(path.join(emptyDir, "USER.md"), "<!-- observed: 2026-10-16 | status: active -->\n\n- Always 交回 JSON。\n");
    let rejected = false;
    try {
      await assertPrompts(emptyDir);
    } catch (error) {
      rejected = error.message.includes("IDENTITY.md");
    }
    if (!rejected) process.exit(1);
    await writeFile(path.join(emptyDir, "IDENTITY.md"), "# IDENTITY.md\n\n- **Name:** 数据评审员\n- **Vibe:** 短\n");
    await rm(path.join(emptyDir, "USER.md"));
    let missing = false;
    try {
      await assertPrompts(emptyDir);
    } catch (error) {
      missing = error.message.includes("缺少 USER.md");
    }
    if (!missing) process.exit(1);
  } finally {
    await rm(emptyDir, { recursive: true, force: true });
  }
  process.stdout.write("patch ok\n");
} else if (isDirect) {
  process.stderr.write("usage: apply-config.mjs ids|internal-ids|retired-ids|seed|snapshot|sync|sync-report|main-brief|patch-test\n");
  process.exit(2);
}
