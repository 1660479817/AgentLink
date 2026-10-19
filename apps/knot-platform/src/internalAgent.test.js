import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { agentEnvText, ensureInternalAgent, internalAgentEmail, internalAgentName, writeAgentEnvFile } from "./internalAgent.js";

// 管理员邮箱现在必须来自配置；这个文件里所有用例共用一个测试值。
process.env.KNOT_ADMIN_EMAIL = process.env.KNOT_ADMIN_EMAIL || "ops@example.com";

test("an internal agent name is a short label", () => {
  assert.equal(internalAgentName("bravesearch"), "bravesearch");
  assert.equal(internalAgentName(" 豆包 "), "豆包");
  assert.equal(internalAgentName(" BraveSearch "), "BraveSearch");
  assert.equal(internalAgentName(""), null);
  assert.equal(internalAgentName("a".repeat(41)), null);
  assert.equal(internalAgentName("豆 包"), null);
  assert.equal(internalAgentName("../豆包"), null);
});

test("an internal agent code file stays private", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-agent-"));
  try {
    const token = "issued-token-value";
    const file = await writeAgentEnvFile(dir, {
      displayName: "豆包",
      email: "manwjh@gmail.com",
      userId: "11111111-1111-4111-8111-111111111111",
      token,
    });
    assert.equal(file, path.join(dir, "豆包.local.env"));
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(
      await readFile(file, "utf8"),
      agentEnvText({
        displayName: "豆包",
        email: "manwjh@gmail.com",
        userId: "11111111-1111-4111-8111-111111111111",
        token,
      })
    );
    assert.equal((await readdir(dir)).some((name) => name.endsWith(".tmp")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a duplicate internal name keeps the first account", async () => {
  let selects = 0;
  const pool = {
    async query(sql) {
      if (sql.includes("lower(btrim(display_name))")) {
        selects += 1;
        if (selects === 1) return { rows: [], rowCount: 0 };
        return { rows: [{ id: "11111111-1111-4111-8111-111111111111", points_balance: 40, side: "internal" }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO users")) {
        const error = new Error("duplicate");
        error.code = "23505";
        throw error;
      }
      if (sql.includes("FROM delegations")) return { rows: [{ ok: 1 }], rowCount: 1 };
      throw new Error(sql);
    },
  };
  const issued = await ensureInternalAgent(pool, "豆包");
  assert.equal(issued.created, false);
  assert.equal(issued.token, null);
  assert.equal(issued.userId, "11111111-1111-4111-8111-111111111111");
  assert.equal(issued.pointsBalance, 40);
});

test("a name held by an external account blocks the internal agent", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("lower(btrim(display_name))")) {
        return { rows: [{ id: "22222222-2222-4222-8222-222222222222", points_balance: 12, side: "external" }], rowCount: 1 };
      }
      throw new Error(sql);
    },
  };
  await assert.rejects(() => ensureInternalAgent(pool, "豆包"), (error) => error.code === "name_taken");
});

test("internal agents share the admin mailbox", () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  process.env.KNOT_ADMIN_EMAIL = "ops@example.com";
  try {
    assert.equal(internalAgentEmail(), "ops@example.com");
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
});
