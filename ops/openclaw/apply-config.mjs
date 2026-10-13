import { access, chmod, copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
const configPath = path.join(stateDir, "openclaw.json");
const snapshotPath = path.join(stateDir, "knot-config-snapshot.json");
const promptFiles = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"];

export function visibleSkills(manifest, agent) {
  if (agent.common === false) return [...agent.skills];
  return [...manifest.commonSkills, ...agent.skills];
}

export function skillSources(names) {
  return names.filter((name) => name === "SKILL.md" || name === "admin" || (name.endsWith(".mjs") && !name.endsWith(".test.mjs")));
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
    for (const skill of visibleSkills(manifest, agent)) {
      const sourceDir = path.join(root, "skills", skill);
      const destDir = path.join(workspace, "skills", skill);
      await mkdir(destDir, { recursive: true });
      const names = skillSources(await readdir(sourceDir));
      if (!names.includes("SKILL.md")) throw new Error(`missing SKILL.md for ${skill}`);
      for (const name of names) {
        const dest = path.join(destDir, name);
        await copyFile(path.join(sourceDir, name), dest);
        if (name === "admin") await chmod(dest, 0o755);
      }
    }
  }
  let config = await restore(await readConfig());
  config = patchConfig(config, manifest);
  await writeConfig(config);
  await rm(snapshotPath, { force: true });
}

const command = process.argv[2];
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const manifest = !isDirect || command === "patch-test" ? null : await readManifest();

if (isDirect && command === "ids") {
  process.stdout.write(`${manifest.agents.map((agent) => agent.id).join("\n")}\n`);
} else if (isDirect && command === "snapshot") {
  await snapshot();
} else if (isDirect && command === "sync") {
  await sync();
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
  process.stdout.write("patch ok\n");
} else if (isDirect) {
  process.stderr.write("usage: apply-config.mjs ids|snapshot|sync|patch-test\n");
  process.exit(2);
}
