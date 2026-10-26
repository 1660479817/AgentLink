import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = fileURLToPath(new URL("./openclaw-check.sh", import.meta.url));

// 一个假的 openclaw：按子命令回话，好让脚本的每一行都能被单独摆到该有的状态。
function shim({ version = "2026.10.1", health = 0, agents = "", cron = '{"jobs":[]}' } = {}) {
  return [
    "#!/usr/bin/env bash",
    'case "$1" in',
    `  --version) echo "OpenClaw ${version}" ;;`,
    `  gateway) exit ${health} ;;`,
    "  agents) cat <<'AGENTS'",
    agents,
    "AGENTS",
    "  ;;",
    "  cron) cat <<'CRON'",
    cron,
    "CRON",
    "  ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n");
}

function env({ withOpenclaw, stateDir, openclaw = "{}", site = "bot01" }) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-openclaw-check-"));
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  // 脚本要用 node 比对版本、读名单；假 PATH 里也得有它。
  symlinkSync(process.execPath, path.join(bin, "node"));
  if (withOpenclaw !== false) {
    writeFileSync(path.join(bin, "openclaw"), shim(withOpenclaw), { mode: 0o755 });
    chmodSync(path.join(bin, "openclaw"), 0o755);
  }
  if (openclaw !== null) {
    writeFileSync(path.join(stateDir, "openclaw.json"), JSON.stringify(openclaw), { mode: 0o600 });
  }
  return {
    dir,
    run() {
      return spawnSync("bash", [SCRIPT], {
        encoding: "utf8",
        env: {
          PATH: `${bin}:/usr/bin:/bin`,
          HOME: dir,
          OPENCLAW_STATE_DIR: stateDir,
          KNOT_SITE: site,
        },
      });
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function withSite(fn) {
  const stateDir = mkdtempSync(path.join(tmpdir(), "knot-openclaw-state-"));
  return Promise.resolve(fn(stateDir)).finally(() => rmSync(stateDir, { recursive: true, force: true }));
}

const FULL_CONFIG = {
  models: { providers: { local: { models: ["a-model"] } } },
  auth: { profiles: { default: {} } },
};

test("没有 openclaw 也要退出 0，并把每一行说成 off 或 warn", async () => {
  await withSite(async (stateDir) => {
    const run = env({ withOpenclaw: false, stateDir, openclaw: null });
    try {
      const result = run.run();
      // 这台机器上没有 OpenClaw 是合法状态：退出码必须是 0。
      assert.equal(result.status, 0);
      assert.match(result.stdout, /off\s+version/);
      assert.match(result.stdout, /off\s+gateway/);
      assert.match(result.stdout, /off\s+agents/);
      assert.match(result.stdout, /off\s+patrol/);
      assert.match(result.stdout, /warn\s+state dir/);
    } finally {
      run.cleanup();
    }
  });
});

test("一切正常时六行都是 ok", async () => {
  await withSite(async (stateDir) => {
    const run = env({
      stateDir,
      openclaw: FULL_CONFIG,
      withOpenclaw: {
        agents: "knot-intel\nknot-admin\nknot-actuary\n",
        cron: '{"jobs":[{"name":"knot-admin-patrol"}]}',
      },
    });
    try {
      const result = run.run();
      assert.equal(result.status, 0);
      assert.equal((result.stdout.match(/\bok\b/g) || []).length, 6);
      assert.match(result.stdout, /2026\.10\.1/);
    } finally {
      run.cleanup();
    }
  });
});

test("Gateway 不健康只影响 gateway 那一行，退出码仍是 0", async () => {
  await withSite(async (stateDir) => {
    const run = env({
      stateDir,
      openclaw: FULL_CONFIG,
      withOpenclaw: { health: 1, agents: "knot-intel\nknot-admin\nknot-actuary\n" },
    });
    try {
      const result = run.run();
      assert.equal(result.status, 0);
      assert.match(result.stdout, /warn\s+gateway/);
      assert.match(result.stdout, /ok\s+version/);
    } finally {
      run.cleanup();
    }
  });
});

test("少注册一个 Agent 时点名，而不是只说一句失败", async () => {
  await withSite(async (stateDir) => {
    const run = env({
      stateDir,
      openclaw: FULL_CONFIG,
      withOpenclaw: { agents: "knot-intel\nknot-admin\n" },
    });
    try {
      const result = run.run();
      assert.equal(result.status, 0);
      assert.match(result.stdout, /warn\s+agents/);
      assert.match(result.stdout, /knot-actuary/);
      assert.doesNotMatch(result.stdout.split("warn")[1] || "", /knot-admin\b(?!.*knot-actuary)/);
    } finally {
      run.cleanup();
    }
  });
});

test("cron 输出不是 JSON 也只 warn，不中断报告", async () => {
  await withSite(async (stateDir) => {
    const run = env({
      stateDir,
      openclaw: FULL_CONFIG,
      withOpenclaw: { agents: "knot-intel\nknot-admin\nknot-actuary\n", cron: "not json" },
    });
    try {
      const result = run.run();
      assert.equal(result.status, 0);
      assert.match(result.stdout, /warn\s+patrol/);
      // 前五行照样出得来：一行坏了不该吞掉后面的报告。
      assert.match(result.stdout, /ok\s+version/);
    } finally {
      run.cleanup();
    }
  });
});

test("模型没配置时分开说清是缺清单还是缺凭据", async () => {
  await withSite(async (root) => {
    // 各用一份状态目录：env() 会把 openclaw.json 写在里面，共用一个会把前一份覆盖掉。
    const noauthDir = path.join(root, "noauth");
    const nomodelDir = path.join(root, "nomodel");
    mkdirSync(noauthDir);
    mkdirSync(nomodelDir);
    const noauth = env({ stateDir: noauthDir, openclaw: { models: FULL_CONFIG.models } });
    const nomodel = env({ stateDir: nomodelDir, openclaw: { auth: FULL_CONFIG.auth } });
    try {
      assert.match(noauth.run().stdout, /auth\.profiles 为空/);
      assert.match(nomodel.run().stdout, /models\.providers 为空/);
    } finally {
      noauth.cleanup();
      nomodel.cleanup();
    }
  });
});

test("脚本里没有非零退出路径", () => {
  const source = readFileSync(SCRIPT, "utf8");
  // 契约写在这里：这个文件永远不让调用方失败。
  // 只认行首的语句，注释里提到 exit 1 不算。
  assert.doesNotMatch(source, /^\s*exit\s+[1-9]/m);
  assert.doesNotMatch(source, /^\s*set\s+-[a-z]*e/m);
  assert.match(source.trimEnd(), /exit 0$/);
});
