import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { adminRouter } from "./admin.js";

const TOKEN = "test-token";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// 假连接池：审核那条按 percentile_cont 认，巡查那条按 admin_actions 认。
function statusPool({ broken = false, gaveUpAt = 0 } = {}) {
  return {
    async query(sql) {
      if (broken) throw new Error("db down");
      if (sql.includes("percentile_cont")) {
        return {
          rows: [
            {
              last_success_at: new Date("2026-10-26T03:18:00.000Z"),
              pending_count: 0,
              pending_oldest: null,
              gave_up: gaveUpAt,
              p50: null,
              p95: null,
            },
          ],
        };
      }
      if (sql.includes("reviewError")) return { rows: [] };
      if (sql.includes("admin_actions")) {
        return { rows: [{ last_at: new Date("2026-10-26T01:00:00.000Z"), today: 1 }] };
      }
      throw new Error(`unexpected ${sql}`);
    },
  };
}

async function withAdmin(fn, { pool = statusPool(), status } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-admin-status-"));
  const previousRoot = process.env.KNOT_DEPLOY_ROOT;
  const previousEnvDir = process.env.KNOT_AGENT_ENV_DIR;
  // 状态文件的位置从这个变量推。用例自己给一个临时部署根，
  // 既测到「文件在」，也不碰开发机上真实的 var/run。
  process.env.KNOT_DEPLOY_ROOT = dir;
  delete process.env.KNOT_AGENT_ENV_DIR;
  if (status !== undefined) {
    mkdirSync(path.join(dir, "var", "run"), { recursive: true });
    writeFileSync(path.join(dir, "var", "run", "openclaw-status.json"), JSON.stringify(status), { mode: 0o600 });
  }

  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool, token: TOKEN, publicWebOrigin: "https://knot.example" }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const call = (pathname, options = {}) =>
    fetch(`${base}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });

  try {
    return await fn({ call });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousRoot === undefined) delete process.env.KNOT_DEPLOY_ROOT;
    else process.env.KNOT_DEPLOY_ROOT = previousRoot;
    if (previousEnvDir === undefined) delete process.env.KNOT_AGENT_ENV_DIR;
    else process.env.KNOT_AGENT_ENV_DIR = previousEnvDir;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("状态端点把审核、巡查、宿主三块一起给出来", async () => {
  await withAdmin(
    async ({ call }) => {
      const response = await call("/status");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json();
      assert.equal(data.review.ok, true);
      assert.equal(data.review.pending.count, 0);
      assert.equal(data.review.lastSuccessAt, "2026-10-26T03:18:00.000Z");
      assert.deepEqual(data.patrol.lastAt, "2026-10-26T01:00:00.000Z");
      assert.equal(data.patrol.today, 1);
      assert.equal(data.openclaw.state, "degraded");
      assert.equal(data.openclaw.stale, false);
      assert.deepEqual(data.openclaw.agents, { expected: 3, registered: 3, missing: [] });
    },
    {
      status: {
        state: "degraded",
        checkedAt: new Date().toISOString(),
        gateway: { ok: true, port: 18789 },
        agents: { expected: 3, registered: 3, missing: [] },
      },
    }
  );
});

test("库全挂了也是 200：旁路坏了不能看起来像站点坏了", async () => {
  await withAdmin(
    async ({ call }) => {
      const response = await call("/status");
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.review.ok, false);
      assert.equal(data.review.lastSuccessAt, null);
      assert.deepEqual(data.patrol, { ok: false, lastAt: null, today: null });
      // 没有状态文件就是 unknown，而不是错误。
      assert.equal(data.openclaw.state, "unknown");
      assert.equal(data.openclaw.reason, "no_status_file");
    },
    { pool: statusPool({ broken: true }) }
  );
});

test("没有凭据就读不到状态", async () => {
  await withAdmin(async ({ call }) => {
    const response = await call("/status", { headers: { Authorization: "" } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "bad_token" });
  });
});
