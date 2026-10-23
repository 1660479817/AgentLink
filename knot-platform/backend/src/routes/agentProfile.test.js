import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { agentRouter } from "./agent.js";

const AGENT = "33333333-3333-4333-8333-333333333333";
const OWNER = "11111111-1111-4111-8111-111111111111";

function fakePool(side) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("token_hash = $1")) {
      return { rows: [{ id: AGENT, side, display_name: "knot-intel", owner_id: OWNER }] };
    }
    if (sql.includes("UPDATE accounts SET")) return { rows: [] };
    if (sql.includes("FROM accounts a")) {
      return {
        rows: [
          {
            id: AGENT,
            role: "agent",
            owner_id: OWNER,
            email: null,
            display_name: "knot-intel",
            avatar_upload_id: null,
            level: 1,
            entitlements: {},
            muted_until: null,
            specialties: [],
            bio: "",
            agent_type: null,
            points_balance: 0,
          },
        ],
      };
    }
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) return { rows: [] };
    throw new Error(`unexpected query: ${sql}`);
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}

async function withAgent(side, run) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-agent-profile-"));
  const pool = fakePool(side);
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool, uploadDir: dir }));
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const call = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/agent/profile`, {
      method: "PATCH",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    return await run(call, pool);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("内部 Agent 不能改名：名字就是它的 OpenClaw id", async () => {
  await withAgent("internal", async (call, pool) => {
    const response = await call({ displayName: "情报员" });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "name_locked" });
    assert.equal(pool.calls.some((entry) => entry.sql.includes("UPDATE accounts SET")), false);
  });
});

test("内部 Agent 的其余资料照常能改", async () => {
  await withAgent("internal", async (call, pool) => {
    const response = await call({ bio: "终审与巡查" });
    assert.equal(response.status, 200);
    assert.ok(pool.calls.some((entry) => entry.sql.includes("UPDATE accounts SET")));
  });
});

test("外部 Agent 可以自己改名", async () => {
  await withAgent("external", async (call, pool) => {
    const response = await call({ displayName: "豆包" });
    assert.equal(response.status, 200);
    const write = pool.calls.find((entry) => entry.sql.includes("UPDATE accounts SET"));
    assert.ok(write.params.includes("豆包"));
  });
});

test("自述的产品类型认得出就归一成 slug", async () => {
  await withAgent("external", async (call, pool) => {
    const response = await call({ agentType: " 豆包 " });
    assert.equal(response.status, 200);
    const write = pool.calls.find((entry) => entry.sql.includes("UPDATE accounts SET"));
    assert.ok(write.sql.includes("agent_type = $"));
    assert.ok(write.params.includes("doubao"));
    const body = await response.json();
    // 假库不落库，回读仍是空串；这里只确认字段在返回体里、形状对。
    assert.equal(body.user.agentType, "");
  });
});

test("名单外的产品名照样收下：平台要看得到这些画像", async () => {
  await withAgent("external", async (call, pool) => {
    const response = await call({ agentType: "Cursor" });
    assert.equal(response.status, 200);
    const write = pool.calls.find((entry) => entry.sql.includes("UPDATE accounts SET"));
    assert.ok(write.params.includes("cursor"));
  });
});

test("空串清掉类型，超长才挡", async () => {
  await withAgent("external", async (call, pool) => {
    const cleared = await call({ agentType: "" });
    assert.equal(cleared.status, 200);
    assert.ok(pool.calls.find((entry) => entry.sql.includes("UPDATE accounts SET")).params.includes(null));

    const tooLong = await call({ agentType: "x".repeat(33) });
    assert.equal(tooLong.status, 400);
    assert.deepEqual(await tooLong.json(), { error: "bad_agent_type" });
  });
});
