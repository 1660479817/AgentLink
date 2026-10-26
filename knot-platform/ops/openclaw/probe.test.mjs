import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { collect, probePaths } from "./probe.mjs";

const PROBE = fileURLToPath(new URL("./probe.mjs", import.meta.url));

function root() {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-probe-"));
  const run = path.join(dir, "var", "run");
  mkdirSync(run, { recursive: true });
  return {
    dir,
    run,
    state: path.join(dir, "state"),
    paths: {
      status: path.join(run, "openclaw-status.json"),
      sync: path.join(run, "openclaw-sync.json"),
      request: path.join(run, "openclaw-probe.request"),
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const HEALTHY = {
  "--version": "openclaw 2026.10.1",
  gateway: "ok",
  agents: "knot-intel\nknot-admin\nknot-actuary\n",
  cron: "[]",
};

function fakeExec(overrides = {}, calls = []) {
  return (file, args) => {
    calls.push(args.join(" "));
    const key = args[0] === "--version" ? "--version" : args[0];
    const answer = key in overrides ? overrides[key] : HEALTHY[key];
    return answer === undefined ? null : answer;
  };
}

test("the probe finds its files from the deploy root, and nowhere else", () => {
  const paths = probePaths({ KNOT_DEPLOY_ROOT: "/srv/knot" });
  assert.equal(paths.status, path.join("/srv/knot", "var", "run", "openclaw-status.json"));
  assert.equal(paths.sync, path.join("/srv/knot", "var", "run", "openclaw-sync.json"));
  assert.equal(paths.request, path.join("/srv/knot", "var", "run", "openclaw-probe.request"));
  assert.equal(probePaths({}), null);
});

test("an off written by the deployment is a decision, not a reading", async () => {
  const site = root();
  const calls = [];
  try {
    writeFileSync(site.paths.status, JSON.stringify({ state: "off", checkedAt: "2026-01-01T00:00:00Z" }));
    const status = await collect({
      paths: site.paths,
      stateDir: site.state,
      now: Date.parse("2026-10-26T04:00:00.000Z"),
      exec: fakeExec({}, calls),
    });
    assert.deepEqual(status, { state: "off", checkedAt: "2026-10-26T04:00:00.000Z" });
    // 连一次 CLI 都不该为它跑：这条不是观测出来的。
    assert.deepEqual(calls, []);
  } finally {
    site.cleanup();
  }
});

test("no openclaw is unknown, never a failure", async () => {
  const site = root();
  try {
    const status = await collect({
      paths: site.paths,
      stateDir: site.state,
      now: 0,
      exec: () => null,
    });
    assert.equal(status.state, "unknown");
    assert.equal(status.reason, "not_installed");
  } finally {
    site.cleanup();
  }
});

test("a healthy host is ok, with the agent list taken from the sync report", async () => {
  const site = root();
  try {
    mkdirSync(site.state, { recursive: true });
    writeFileSync(
      path.join(site.state, "openclaw.json"),
      JSON.stringify({ models: { providers: { p: { models: ["m"] } } }, auth: { profiles: { d: {} } } })
    );
    writeFileSync(
      site.paths.sync,
      JSON.stringify({ syncedAt: "2026-10-26T04:00:00Z", agents: ["knot-intel", "knot-admin", "knot-actuary"] })
    );
    const status = await collect({
      paths: site.paths,
      stateDir: site.state,
      now: Date.parse("2026-10-26T04:10:00.000Z"),
      exec: fakeExec({ cron: '[{"name":"knot-admin-patrol"}]' }),
    });
    assert.equal(status.state, "ok");
    assert.equal(status.version, "2026.10.1");
    assert.deepEqual(status.gateway, { ok: true, port: 18789 });
    assert.deepEqual(status.model, { configured: true });
    assert.deepEqual(status.agents, { expected: 3, registered: 3, missing: [] });
    assert.deepEqual(status.cron, { patrol: "ok" });
  } finally {
    site.cleanup();
  }
});

test("a dead gateway, an unconfigured model or a missing agent all read as degraded", async () => {
  const site = root();
  try {
    const status = await collect({
      paths: site.paths,
      stateDir: site.state,
      now: 0,
      exec: fakeExec({ gateway: null, agents: "knot-intel\n" }),
    });
    assert.equal(status.state, "degraded");
    assert.equal(status.gateway.ok, false);
    assert.equal(status.model.configured, false);
    assert.deepEqual(status.agents.missing, ["knot-admin", "knot-actuary"]);
  } finally {
    site.cleanup();
  }
});

test("the expensive checks are reused for an hour unless someone asks for a fresh one", async () => {
  const site = root();
  try {
    const at = Date.parse("2026-10-26T04:00:00.000Z");
    writeFileSync(
      site.paths.status,
      JSON.stringify({
        state: "degraded",
        checkedAt: "2026-10-26T04:00:00.000Z",
        agents: { expected: 3, registered: 3, missing: [] },
        cron: { patrol: "ok" },
        cache: { agentsAt: "2026-10-26T04:00:00.000Z", cronAt: "2026-10-26T04:00:00.000Z" },
      })
    );

    const warm = [];
    await collect({ paths: site.paths, stateDir: site.state, now: at + 5 * 60_000, exec: fakeExec({}, warm) });
    assert.deepEqual(warm, ["--version", "gateway health --port 18789"]);

    // 请求文件在，就把贵的那两项重跑一次。
    writeFileSync(site.paths.request, "");
    const cold = [];
    const refreshed = await collect({ paths: site.paths, stateDir: site.state, now: at + 6 * 60_000, exec: fakeExec({}, cold) });
    assert.ok(cold.includes("agents list"));
    assert.ok(cold.includes("cron list --all --json"));
    assert.equal(refreshed.cache.agentsAt, "2026-10-26T04:06:00.000Z");
  } finally {
    site.cleanup();
  }
});

test("an unparsable agents list counts as missing, not as fine", async () => {
  const site = root();
  try {
    const status = await collect({
      paths: site.paths,
      stateDir: site.state,
      now: 0,
      exec: fakeExec({ agents: "some unrelated output" }),
    });
    assert.equal(status.state, "degraded");
    assert.equal(status.agents.missing.length, 3);
  } finally {
    site.cleanup();
  }
});

test("running the probe twice leaves no partial file behind", async () => {
  const site = root();
  try {
    // 两条只用 node、不碰真 openclaw：这里测的是落盘卫生，不是探测内容。
    const env = { PATH: "/usr/bin:/bin", HOME: site.state, KNOT_DEPLOY_ROOT: site.dir };
    spawnSync(process.execPath, [PROBE], { encoding: "utf8", env });
    spawnSync(process.execPath, [PROBE], { encoding: "utf8", env });
    const names = readdirSync(site.run).filter((name) => name.startsWith("openclaw-status"));
    assert.deepEqual(names, ["openclaw-status.json"]);
    assert.equal(statSync(site.paths.status).mode & 0o777, 0o600);
    // 没有 openclaw 时写的是 unknown 加原因，不是失败。
    assert.equal(JSON.parse(readFileSync(site.paths.status, "utf8")).state, "unknown");
  } finally {
    site.cleanup();
  }
});

test("the probe exits 0 even with no deploy root and no openclaw", () => {
  const result = spawnSync(process.execPath, [PROBE], {
    encoding: "utf8",
    env: { PATH: "/usr/bin:/bin", HOME: tmpdir() },
  });
  assert.equal(result.status, 0);
  assert.match(result.stderr, /没有 KNOT_DEPLOY_ROOT/);
});

// 部署机上单元从 <部署根>/current 拉起，那是软链。一旦「是否直接执行」用字符串比路径，
// 探测就会一声不吭地什么都不做、退出 0，日志空白——这一条守的就是那个失败形态。
test("the probe still runs when the unit reaches it through a symlink", () => {
  const site = root();
  try {
    const link = path.join(site.dir, "current-probe.mjs");
    symlinkSync(PROBE, link);
    const result = spawnSync(process.execPath, [link], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: site.state, KNOT_DEPLOY_ROOT: site.dir },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(site.paths.status, "utf8").includes("unknown"), true);
    // 也要求它把结论说出来：空白日志正是这个 bug 当初的样子。
    assert.match(result.stdout, /state: unknown/);
  } finally {
    site.cleanup();
  }
});
