import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { webRouter } from "./web.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

// 只实现「我的」页这三条路由会用到的查询；别的路径一被碰到就报错，免得测试假过。
function fakePool(role, { agents = [], onWrite } = {}) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^SELECT id, role FROM accounts WHERE id = \$1/.test(sql.trim())) return { rows: [{ id: params[0], role }] };
    if (/^SELECT id, role, display_name FROM accounts WHERE id = \$1/.test(sql.trim())) {
      return { rows: [{ id: params[0], role, display_name: "甲" }] };
    }
    if (sql.includes("ORDER BY created_at ASC")) return { rows: agents };
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (sql.includes("retired_at IS NOT NULL")) return { rows: [] };
    if (sql.includes("INSERT INTO accounts")) {
      onWrite?.("create", params);
      return { rows: [{ id: AGENT, display_name: params[1], created_at: "2026-10-22T00:00:00.000Z" }] };
    }
    if (sql.includes("owner_id = $1 AND role = 'agent'")) return { rows: [] };
    if (sql.includes("UPDATE accounts") && sql.includes("retired_at = now()")) {
      onWrite?.("retire", params);
      return { rows: [{ id: params[0], owner_id: USER, display_name: "甲 的 Agent" }] };
    }
    if (sql.includes("UPDATE accounts") && sql.includes("token_hash = $2")) {
      onWrite?.("rotate", params);
      return { rows: [{ id: params[0], display_name: "甲 的 Agent", created_at: "2026-10-22T00:00:00.000Z" }] };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}

async function withPanel(account, pool, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-agent-panel-"));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.account = account;
    next();
  });
  app.use(
    "/api/web",
    webRouter({ pool, sessionCookieName: "knot_sid", uploadDir: dir, profile: { view: () => ({ site: null }) } })
  );
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/web/agent`;
  try {
    return await run((method = "GET", body) =>
      fetch(base, {
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
      })
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("主理人看到的是十个名额的只读面板", async () => {
  const pool = fakePool("owner", { agents: [] });
  await withPanel({ id: OWNER }, pool, async (call) => {
    const response = await call();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { role: "owner", limit: 10, selfService: false, agents: [] });
  });
});

test("外部账号看到的是一个名额的自助面板", async () => {
  const pool = fakePool("user", {
    agents: [{ id: AGENT, display_name: "甲 的 Agent", created_at: "2026-10-22T00:00:00.000Z", has_token: true }],
  });
  await withPanel({ id: USER }, pool, async (call) => {
    const data = await (await call()).json();
    assert.equal(data.limit, 1);
    assert.equal(data.selfService, true);
    assert.deepEqual(data.agents, [
      { id: AGENT, displayName: "甲 的 Agent", createdAt: "2026-10-22T00:00:00.000Z", hasToken: true },
    ]);
  });
});

test("主理人不能从网页给自己签发或停用 Agent", async () => {
  for (const method of ["POST", "DELETE"]) {
    const writes = [];
    const pool = fakePool("owner", { agents: [{ id: AGENT }], onWrite: (kind) => writes.push(kind) });
    await withPanel({ id: OWNER }, pool, async (call) => {
      const response = await call(method);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "not_user" });
    });
    // 内部 Agent 由管理端停用：这条路上一个字都不该写。
    assert.deepEqual(writes, []);
    assert.equal(pool.calls.some((entry) => entry.sql.includes("UPDATE accounts")), false);
  }
});

test("外部账号换码只换自己的那一行，回 200", async () => {
  const writes = [];
  const pool = fakePool("user", { agents: [{ id: AGENT }], onWrite: (kind, params) => writes.push({ kind, params }) });
  await withPanel({ id: USER }, pool, async (call) => {
    const response = await call("POST");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.match(data.token, /^[A-Za-z0-9_-]{20,}$/);
    assert.equal(data.agent.id, AGENT);
  });
  assert.deepEqual(writes.map((entry) => entry.kind), ["rotate"]);
  assert.equal(writes[0].params[0], AGENT);
});

test("外部账号第一次开通才回 201", async () => {
  const writes = [];
  const pool = fakePool("user", { agents: [], onWrite: (kind, params) => writes.push({ kind, params }) });
  await withPanel({ id: USER }, pool, async (call) => {
    const response = await call("POST");
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.agent.displayName, "甲 的 Agent");
    assert.match(data.token, /^[A-Za-z0-9_-]{20,}$/);
  });
  assert.deepEqual(writes.map((entry) => entry.kind), ["create"]);
});

test("外部账号停用时保留行、清掉令牌", async () => {
  const writes = [];
  const pool = fakePool("user", { agents: [{ id: AGENT }], onWrite: (kind, params) => writes.push({ kind, params }) });
  await withPanel({ id: USER }, pool, async (call) => {
    const response = await call("DELETE");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
  assert.deepEqual(writes.map((entry) => entry.kind), ["retire"]);
  assert.equal(writes[0].params[0], AGENT);
});
