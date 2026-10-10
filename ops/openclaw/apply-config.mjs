import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
const configPath = path.join(stateDir, "openclaw.json");
const snapshotPath = path.join(stateDir, "knot-config-snapshot.json");
const promptFiles = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"];

export function patchConfig(config, manifest) {
  const next = structuredClone(config);
  next.agents ??= {};
  next.agents.entries ??= {};
  for (const agent of manifest.agents) {
    const entry = next.agents.entries[agent.id];
    if (!entry) continue;
    entry.skills = [...manifest.commonSkills, ...agent.skills];
    entry.subagents = { ...(entry.subagents || {}), allowAgents: [...agent.allowAgents] };
  }
  return next;
}

export function visibleSkills(manifest, agent) {
  return [...manifest.commonSkills, ...agent.skills];
}

async function readManifest() {
  return JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
}

async function readConfig() {
  return JSON.parse(await readFile(configPath, "utf8"));
}

async function writeConfig(config) {
  const tmp = `${configPath}.knot-tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`);
  await rename(tmp, configPath);
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

async function sync() {
  const manifest = await readManifest();
  for (const agent of manifest.agents) {
    const workspace = path.join(stateDir, `workspace-${agent.id}`);
    await mkdir(workspace, { recursive: true });
    for (const name of promptFiles) {
      await copyFile(path.join(root, "agents", agent.id, name), path.join(workspace, name));
    }
    for (const skill of visibleSkills(manifest, agent)) {
      const source = path.join(root, "skills", skill, "SKILL.md");
      const destDir = path.join(workspace, "skills", skill);
      await mkdir(destDir, { recursive: true });
      await copyFile(source, path.join(destDir, "SKILL.md"));
    }
  }
  let config = await restore(await readConfig());
  config = patchConfig(config, manifest);
  await writeConfig(config);
  await rm(snapshotPath, { force: true });
}

const command = process.argv[2];
const manifest = command === "patch-test" ? null : await readManifest();

if (command === "ids") {
  process.stdout.write(`${manifest.agents.map((agent) => agent.id).join("\n")}\n`);
} else if (command === "snapshot") {
  await snapshot();
} else if (command === "sync") {
  await sync();
} else if (command === "patch-test") {
  const sample = {
    bindings: [{ agentId: "main" }],
    agents: { entries: { "knot-process": { name: "knot-process" } } },
  };
  const patched = patchConfig(sample, {
    commonSkills: ["knot-employee"],
    agents: [{ id: "knot-process", skills: ["knot-process"], allowAgents: [] }, { id: "missing", skills: ["x"], allowAgents: [] }],
  });
  const names = patched.agents.entries["knot-process"].skills;
  if (names[0] !== "knot-employee" || names[1] !== "knot-process") process.exit(1);
  if (patched.agents.entries["knot-process"].subagents.allowAgents.length !== 0) process.exit(1);
  if (patched.agents.entries.missing) process.exit(1);
  if (patched.bindings[0].agentId !== "main") process.exit(1);
  process.stdout.write("patch ok\n");
} else {
  process.stderr.write("usage: apply-config.mjs ids|snapshot|sync|patch-test\n");
  process.exit(2);
}
