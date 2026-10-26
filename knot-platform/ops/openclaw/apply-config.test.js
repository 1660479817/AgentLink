import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  briefBlock,
  internalAgentIds,
  patchAgentsBrief,
  renderBrief,
  renderSyncReport,
  reportFilePath,
  resolveMainWorkspace,
  retiredAgentIds,
  writeMainBrief,
  writeSyncReport,
} from "./apply-config.mjs";

const manifest = (...ids) => ({ agents: ids.map((id) => ({ id, skills: [], allowAgents: [] })) });

test("a platform agent dropped from the manifest is reported as retired", () => {
  const config = {
    agents: {
      entries: {
        "knot-intel": { name: "knot-intel" },
        "knot-admin": { name: "knot-admin" },
        "knot-retrieval": { name: "knot-retrieval" },
      },
    },
  };
  assert.deepEqual(retiredAgentIds(config, manifest("knot-intel", "knot-admin")), ["knot-retrieval"]);
});

test("nothing is retired while the manifest still lists the agent", () => {
  const config = { agents: { entries: { "knot-intel": {}, "knot-admin": {}, "knot-actuary": {} } } };
  assert.deepEqual(retiredAgentIds(config, manifest("knot-intel", "knot-admin", "knot-actuary")), []);
});

test("a human's agent and an internal agent are never retired", () => {
  const config = {
    agents: {
      entries: {
        "knot-intel": {},
        main: {},
        manwjh: {},
        "AI-Roaster": {},
        "随性的豆包": {},
      },
    },
  };
  assert.deepEqual(retiredAgentIds(config, manifest("knot-intel")), []);
});

test("every knot- entry is retired when the manifest lists none", () => {
  const config = { agents: { entries: { "knot-intel": {}, "knot-actuary": {}, main: {} } } };
  assert.deepEqual(retiredAgentIds(config, manifest()), ["knot-actuary", "knot-intel"]);
});

test("a config with no agents table has nothing to retire", () => {
  assert.deepEqual(retiredAgentIds({}, manifest("knot-intel")), []);
  assert.deepEqual(retiredAgentIds({ agents: {} }, manifest("knot-intel")), []);
});

// knot- 前缀是平台管理 Agent 的保留前缀；内部 Agent 用别的名字，所以两者不会互相覆盖。
test("internal agent ids skip the reserved knot- prefix", () => {
  assert.deepEqual(internalAgentIds(["finder", "knot-intel", "Bad Name", ""]), ["finder"]);
});

test("the sync report records which agents should exist and what they can see", () => {
  const report = renderSyncReport({
    syncedAt: "2026-10-26T04:00:00.000Z",
    version: "2026.10.1",
    gatewayPort: "18789",
    patrolCron: "knot-admin-patrol",
    manifest: {
      commonSkills: ["knot-employee"],
      agents: [
        { id: "knot-intel", skills: ["knot-intel"] },
        { id: "knot-admin", skills: ["knot-admin"], common: false },
        { skills: ["no-id"] },
      ],
    },
  });
  assert.deepEqual(report, {
    syncedAt: "2026-10-26T04:00:00.000Z",
    openclawVersion: "2026.10.1",
    gatewayPort: 18789,
    agents: ["knot-intel", "knot-admin"],
    // commonSkills 只给没写 common: false 的 Agent，与 visibleSkills 同一条规则。
    skills: { "knot-intel": ["knot-employee", "knot-intel"], "knot-admin": ["knot-admin"] },
    patrolCron: "knot-admin-patrol",
  });
});

test("an unknown version or port is null, never a made-up value", () => {
  const report = renderSyncReport({ version: "", gatewayPort: "abc", manifest: { agents: [] } });
  assert.equal(report.openclawVersion, null);
  assert.equal(report.gatewayPort, null);
  assert.deepEqual(report.agents, []);
  assert.deepEqual(report.skills, {});
  // syncedAt 缺省时用当下时间，形状稳定，便于运行时判断「上次同步是什么时候」。
  assert.match(report.syncedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("the report path comes from the deploy root, never from the code directory", () => {
  assert.equal(
    reportFilePath({ KNOT_DEPLOY_ROOT: "/srv/knot" }),
    path.join("/srv/knot", "var", "run", "openclaw-sync.json")
  );
  assert.equal(reportFilePath({}), null);
});

test("the report is written atomically, readable only by its owner", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-sync-report-"));
  const file = path.join(dir, "var", "run", "openclaw-sync.json");
  try {
    await writeSyncReport(file, { agents: ["knot-intel"] });
    const mode = statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { agents: ["knot-intel"] });
    // 写完不该留下半份临时文件：读者可能正好在那个瞬间读到它。
    assert.deepEqual(readdirSync(path.dirname(file)), ["openclaw-sync.json"]);

    await writeSyncReport(file, { agents: ["knot-admin"] });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { agents: ["knot-admin"] });

    await assert.rejects(() => writeSyncReport(null, {}), /部署根/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sync-report writes the file where the runtime will look for it", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-sync-cli-"));
  try {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./apply-config.mjs", import.meta.url)),
        "sync-report",
        "--version",
        "2026.10.1",
        "--port",
        "18789",
        "--patrol",
        "knot-admin-patrol",
      ],
      { encoding: "utf8", env: { ...process.env, KNOT_DEPLOY_ROOT: dir } }
    );
    assert.equal(result.status, 0, result.stderr);
    const written = path.join(dir, "var", "run", "openclaw-sync.json");
    assert.equal(result.stdout.trim(), written);
    const report = JSON.parse(readFileSync(written, "utf8"));
    assert.equal(report.openclawVersion, "2026.10.1");
    assert.equal(report.gatewayPort, 18789);
    assert.deepEqual(report.agents, ["knot-intel", "knot-admin", "knot-actuary"]);
    assert.equal(report.patrolCron, "knot-admin-patrol");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- main 的说明 ----

test("the brief carries the real paths the agent would otherwise have to guess", () => {
  const brief = renderBrief({ deployRoot: "/srv/knot", site: "example", stateDir: "/home/u/.openclaw", port: "18789" });
  assert.match(brief, /Deploy root: `/);
  assert.match(brief, /\/srv\/knot\/current/);
  assert.match(brief, /\/srv\/knot\/releases\//);
  assert.match(brief, /\/srv\/knot\/sites\/example\//);
  assert.match(brief, /\/srv\/knot\/var\/uploads\//);
  assert.match(brief, /\/srv\/knot\/var\/log\//);
  assert.match(brief, /\/srv\/knot\/var\/run\//);
  assert.match(brief, /\/home\/u\/.openclaw\/workspace-/);
  assert.match(brief, /doctor\.sh --site example/);
  assert.match(brief, /curl -s 127\.0\.0\.1:18789\/api\/health/);
  // 可以读的路径，和明确不许读的文件，都要说清楚。
  assert.match(brief, /platform\.env/);
  assert.match(brief, /openclaw\.json/);
  assert.match(brief, /Before saying the site is down, read `\/api\/health`/);
});

test("a missing port or value is said to be missing, never invented", () => {
  const brief = renderBrief({ deployRoot: "/srv/knot", site: "example", stateDir: "/home/u/.openclaw" });
  assert.equal(brief.includes("curl -s 127.0.0.1"), false);
  const bare = renderBrief({});
  assert.match(bare, /\(not configured\)/);
  assert.equal(bare.includes("curl -s"), false);
});

test("the managed block is appended once, then replaced in place", () => {
  const block = briefBlock();
  const first = patchAgentsBrief("# AGENTS.md\n\n主人写的。\n", block);
  assert.equal(first.match(/knot:begin/g).length, 1);
  assert.match(first, /主人写的。/);
  // 再跑一次不该叠第二份。
  const second = patchAgentsBrief(first, block);
  assert.equal(second, first);
});

test("only the marked region changes; everything the owner wrote survives", () => {
  const original = "# AGENTS.md\n\n前面。\n\n<!-- knot:begin -->\nold\n<!-- knot:end -->\n\n后面。\n";
  const patched = patchAgentsBrief(original, "<!-- knot:begin -->\nnew\n<!-- knot:end -->");
  assert.match(patched, /前面。/);
  assert.match(patched, /后面。/);
  assert.match(patched, /new/);
  assert.equal(patched.includes("old"), false);
  // 没有结尾标记就不当标记区：宁可追加，也不要猜着删一段。
  const broken = patchAgentsBrief("<!-- knot:begin -->\n没有结尾\n", "B");
  assert.match(broken, /没有结尾/);
  assert.match(broken, /B/);
});

test("the workspace comes from the config before it comes from the disk", async () => {
  const seen = [];
  const exists = async (dir) => {
    seen.push(dir);
    return true;
  };
  const declared = { agents: { entries: { main: { workspace: "/tmp/declared" } } } };
  assert.equal(await resolveMainWorkspace({ config: declared, stateDir: "/home/u/.openclaw", exists }), "/tmp/declared");
  const bound = { bindings: [{ agentId: "main", workspace: "/tmp/bound" }] };
  assert.equal(await resolveMainWorkspace({ config: bound, stateDir: "/home/u/.openclaw", exists }), "/tmp/bound");
  const fallback = await resolveMainWorkspace({ config: {}, stateDir: "/home/u/.openclaw", exists });
  assert.equal(fallback, path.join("/home/u/.openclaw", "workspace-main"));
  seen.length = 0;
  const missing = await resolveMainWorkspace({ config: {}, stateDir: "/home/u/.openclaw", exists: async () => false });
  assert.equal(missing, null);
});

test("the brief writes KNOT.md, backs AGENTS.md up once, and never deletes it", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-brief-"));
  const workspace = path.join(dir, "workspace-main");
  try {
    await mkdir(workspace, { recursive: true });
    const agentsPath = path.join(workspace, "AGENTS.md");
    await writeFile(agentsPath, "# AGENTS.md\n\n主人写的。\n", { mode: 0o600 });
    const dry = await writeMainBrief({ workspace, brief: "brief", dryRun: true });
    assert.equal(dry.agentsState, "updated");
    assert.deepEqual(readdirSync(workspace), ["AGENTS.md"]);

    const first = await writeMainBrief({ workspace, brief: "brief" });
    assert.equal(first.backup, `${agentsPath}.knot-before-brief`);
    assert.equal(readFileSync(path.join(workspace, "KNOT.md"), "utf8"), "brief");
    assert.equal(readFileSync(first.backup, "utf8"), "# AGENTS.md\n\n主人写的。\n");
    // 原文件权限沿用，不因为重写变成全世界可读。
    assert.equal(statSync(agentsPath).mode & 0o777, 0o600);
    assert.equal(readFileSync(agentsPath, "utf8").match(/knot:begin/g).length, 1);

    const second = await writeMainBrief({ workspace, brief: "brief2" });
    assert.equal(second.agentsState, "current");
    assert.equal(second.backup, null);
    // 备份只留第一次那份：它记的是我们动它之前的样子。
    assert.equal(readFileSync(first.backup, "utf8"), "# AGENTS.md\n\n主人写的。\n");
    assert.equal(readFileSync(path.join(workspace, "KNOT.md"), "utf8"), "brief2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a workspace without AGENTS.md still gets KNOT.md, and nothing is created", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-brief-"));
  const workspace = path.join(dir, "workspace-main");
  try {
    await mkdir(workspace, { recursive: true });
    const report = await writeMainBrief({ workspace, brief: "brief" });
    assert.equal(report.agentsState, "missing");
    assert.deepEqual(readdirSync(workspace), ["KNOT.md"]);
    const missing = await writeMainBrief({ workspace: null, brief: "brief" });
    assert.deepEqual(missing, { ok: false, reason: "no_workspace" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the subcommands still run when reached through the deploy root's current symlink", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-current-link-"));
  try {
    const link = path.join(dir, "current-apply.mjs");
    symlinkSync(fileURLToPath(new URL("./apply-config.mjs", import.meta.url)), link);
    const result = spawnSync(process.execPath, [link, "ids"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split("\n"), ["knot-intel", "knot-admin", "knot-actuary"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
