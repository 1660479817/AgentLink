import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { readOpenclawStatus, statusFilePath } from "./openclawStatus.js";

const NOW = Date.parse("2026-10-26T04:10:00.000Z");
const FRESH = "2026-10-26T04:05:00.000Z";
const OLD = "2026-10-26T03:00:00.000Z";

async function withFile(contents, fn) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-openclaw-status-"));
  const file = path.join(dir, "openclaw-status.json");
  if (contents != null) {
    writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents), { mode: 0o600 });
  }
  try {
    // 必须 await：直接 return 会让 finally 在回调的 await 落地之前就把目录删掉，
    // 于是第二次读文件成了 ENOENT，测试结果取决于线程池的快慢。
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("状态文件的位置只从进程已有的值推，推不出来就是 null", () => {
  assert.equal(
    statusFilePath({ KNOT_DEPLOY_ROOT: "/srv/knot" }),
    path.join("/srv/knot", "var", "run", "openclaw-status.json")
  );
  // systemd 那条路：platform.env 里带着授权码目录，上三级就是部署根。
  assert.equal(
    statusFilePath({ KNOT_AGENT_ENV_DIR: "/srv/knot/sites/bot01/agents" }),
    path.join("/srv/knot", "var", "run", "openclaw-status.json")
  );
  assert.equal(statusFilePath({}), null);
});

test("没有路径与没有文件都是 unknown，不是故障", async () => {
  assert.deepEqual(await readOpenclawStatus({ file: null, now: NOW }), {
    state: "unknown",
    checkedAt: null,
    stale: true,
    reason: "no_path",
  });
  await withFile(null, async (file) => {
    assert.deepEqual(await readOpenclawStatus({ file, now: NOW }), {
      state: "unknown",
      checkedAt: null,
      stale: true,
      reason: "no_status_file",
    });
  });
});

test("解析不了、不是对象、状态取值不认识，一律 unknown", async () => {
  for (const contents of ["not json", "[]", JSON.stringify({ state: "fine" }), JSON.stringify({ state: 3 })]) {
    await withFile(contents, async (file) => {
      assert.equal((await readOpenclawStatus({ file, now: NOW })).state, "unknown");
    });
  }
});

test("新鲜的状态原样读出来，只读白名单字段", async () => {
  await withFile(
    {
      state: "degraded",
      checkedAt: FRESH,
      version: "2026.10.1",
      // 探测会把 state 目录写进文件，方便部署时对路径；它不该顺着 API 出去。
      stateDir: "/home/user/.openclaw",
      gateway: { ok: true, port: 18789 },
      model: { configured: false },
      agents: { expected: 3, registered: 3, missing: [] },
      cron: { patrol: "ok" },
      // 旁路产物里多写的字段不该顺着 API 出去。
      token: "should-not-leak",
      keyPath: "/home/user/.ssh/id_ed25519",
    },
    async (file) => {
      const status = await readOpenclawStatus({ file, now: NOW });
      assert.equal(status.state, "degraded");
      assert.equal(status.checkedAt, FRESH);
      assert.equal(status.stale, false);
      assert.equal(status.version, "2026.10.1");
      assert.deepEqual(status.gateway, { ok: true, port: 18789 });
      assert.deepEqual(status.model, { configured: false });
      assert.deepEqual(status.agents, { expected: 3, registered: 3, missing: [] });
      assert.deepEqual(status.cron, { patrol: "ok" });
      assert.equal("token" in status, false);
      assert.equal("keyPath" in status, false);
      assert.equal("stateDir" in status, false);
      assert.equal(JSON.stringify(status).includes("id_ed25519"), false);
    }
  );
});

test("超过时限就是 stale，边界上还算新鲜", async () => {
  await withFile({ state: "ok", checkedAt: FRESH }, async (file) => {
    assert.equal((await readOpenclawStatus({ file, now: NOW })).stale, false);
    // 默认时限 15 分钟：刚好卡满不算过期，多一秒才算。
    assert.equal((await readOpenclawStatus({ file, now: NOW + 10 * 60_000 })).stale, false);
    assert.equal((await readOpenclawStatus({ file, now: NOW + 10 * 60_000 + 1 })).stale, true);
  });
});

test("off 是部署写下的事实，不会过期", async () => {
  await withFile({ state: "off", checkedAt: OLD }, async (file) => {
    const status = await readOpenclawStatus({ file, now: NOW });
    assert.equal(status.state, "off");
    assert.equal(status.stale, false);
  });
});

test("探测自己报的 unknown 带原因，且永远不是新鲜的", async () => {
  await withFile({ state: "unknown", checkedAt: FRESH, reason: "gateway_down" }, async (file) => {
    const status = await readOpenclawStatus({ file, now: NOW });
    assert.equal(status.state, "unknown");
    assert.equal(status.reason, "gateway_down");
    assert.equal(status.stale, true);
  });
});
