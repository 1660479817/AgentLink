import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { adminRouter } from "./admin.js";

const TOKEN = "test-token";
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_TOKEN = "agent-plain-token";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function tokenPool({ hash, ownerRole = "owner" }) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("o.role AS owner_role")) {
        const rows = [
          {
            id: AGENT_ID,
            display_name: "豆包",
            owner_id: OWNER_ID,
            owner_role: ownerRole,
            token_hash: hash,
          },
        ];
        return { rows, rowCount: 1 };
      }
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM intel i")) return { rows: [], rowCount: 0 };
      throw new Error(`unexpected ${sql}`);
    },
  };
  return { pool, calls };
}

async function withAdmin(fn, { auditFails = false, ownerRole = "owner", trustProxy = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-admin-agents-"));
  const hash = createHash("sha256").update(AGENT_TOKEN).digest("hex");
  writeFileSync(
    path.join(dir, `${AGENT_ID}.local.env`),
    [`KNOT_AGENT_ID=${AGENT_ID}`, `KNOT_AGENT_NAME=豆包`, `KNOT_AGENT_TOKEN=${AGENT_TOKEN}`, ""].join("\n"),
    { mode: 0o600 }
  );

  const { pool, calls } = tokenPool({ hash, ownerRole });
  if (auditFails) {
    const query = pool.query;
    pool.query = async (sql, params) => {
      if (sql.includes("INSERT INTO admin_actions")) throw new Error("db down");
      return query(sql, params);
    };
  }

  const app = express();
  app.use(express.json());
  // 生产环境 index.js 设了 trust proxy 1：内网门要按真实客户端判（S13-02）。
  if (trustProxy) app.set("trust proxy", true);
  app.use(
    "/api/admin",
    adminRouter({ pool, token: TOKEN, agentEnvDir: dir, publicWebOrigin: "https://knot.example" })
  );
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const call = (pathname, options = {}) =>
    fetch(`${base}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });

  try {
    return await fn({ call, calls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("读内部 Agent 的明文令牌会留下一条审计流水", async () => {
  await withAdmin(async ({ call, calls }) => {
    const response = await call(`/agents/${AGENT_ID}/token`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json();
    assert.equal(data.token, AGENT_TOKEN);

    // 明文令牌等于管理凭据：读一次也要能从流水里查到。
    const audit = calls.find((entry) => entry.sql.includes("INSERT INTO admin_actions"));
    assert.ok(audit);
    assert.equal(audit.params[0], "config");
    assert.equal(audit.params[1], AGENT_ID);
    assert.match(audit.params[3], /明文令牌/);
  });
});

test("审计写不进去就不把明文令牌给出去", async () => {
  await withAdmin(async ({ call }) => {
    const response = await call(`/agents/${AGENT_ID}/token`);
    assert.equal(response.status, 500);
    assert.equal("token" in (await response.json()), false);
  }, { auditFails: true });
});

test("外部 Agent 的明文令牌归它的主人，管理端读不到", async () => {
  await withAdmin(async ({ call, calls }) => {
    const response = await call(`/agents/${AGENT_ID}/token`);
    // 越权是 403，不再和参数错误一起混成 400（S13-01）。
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "not_internal" });
    assert.equal(calls.some((entry) => entry.sql.includes("INSERT INTO admin_actions")), false);
  }, { ownerRole: "user" });
});

test("外部账号的资料只读，经 HTTP 也是 403", async () => {
  const pool = {
    async query() {
      return { rows: [{ id: AGENT_ID, role: "user", owner_id: null, display_name: "路人" }], rowCount: 1 };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool, token: TOKEN, publicWebOrigin: "https://knot.example" }));
  const server = await listen(app);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/admin/accounts/${AGENT_ID}/profile`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: "改名" }),
      }
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "not_editable" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("本机反代转来的公网请求仍被内网门挡住", async () => {
  await withAdmin(
    async ({ call }) => {
      // 入口隧道把远端请求落在回环上，只看 socket 地址会恒放行（S12-07）；这里按真实客户端判。
      const denied = await call("/patrol", { headers: { "X-Forwarded-For": "203.0.113.9" } });
      assert.equal(denied.status, 404);
      assert.deepEqual(await denied.json(), { error: "not_found" });

      const open = await call("/patrol");
      assert.equal(open.status, 200);
    },
    { trustProxy: true }
  );
});
