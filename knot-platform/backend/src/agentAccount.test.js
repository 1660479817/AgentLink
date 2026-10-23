import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  agentByToken,
  agentEnvFileFor,
  agentEnvPath,
  agentIssueError,
  createAgent,
  ensurePersonalAgent,
  findAgentsOf,
  hashAgentToken,
  mapAgentError,
  newAgentToken,
  removeAgentEnvFile,
  retireAgent,
  reviveAgent,
  rotateAgentToken,
  updateAgentEnvName,
  writeAgentEnvFile,
} from "./agentAccount.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";

function fakePool(handler) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    return handler(sql, params);
  };
  return { calls, query, connect: async () => ({ query, release() {} }) };
}

test("a token is random, URL safe, and only its hash is compared", () => {
  const first = newAgentToken();
  const second = newAgentToken();
  assert.match(first, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(first, second);
  assert.equal(hashAgentToken(first), createHash("sha256").update(first).digest("hex"));
});

test("a token finds its agent row and nothing else", async () => {
  const pool = fakePool(() => ({ rows: [{ id: AGENT, role: "agent", owner_id: OWNER }] }));
  const agent = await agentByToken(pool, "secret");
  assert.equal(agent.id, AGENT);
  assert.match(pool.calls[0].sql, /token_hash = \$1/);
  assert.match(pool.calls[0].sql, /role = 'agent'/);
  assert.match(pool.calls[0].sql, /retired_at IS NULL/);
  assert.equal(pool.calls[0].params[0], hashAgentToken("secret"));

  const missing = fakePool(() => ({ rows: [] }));
  assert.equal(await agentByToken(missing, "nope"), null);
});

test("database slot errors turn into codes the UI can translate", () => {
  const code = (value) => Object.assign(new Error("db"), { code: value });
  assert.equal(mapAgentError(code("KN002")).code, "agent_slots_full");
  assert.equal(mapAgentError(code("KN003")).code, "bad_owner");
  assert.equal(mapAgentError(code("KN001")).code, "users_full");
  const taken = Object.assign(new Error("db"), { code: "23505", constraint: "accounts_display_name_key" });
  assert.equal(mapAgentError(taken).code, "name_taken");
  const other = Object.assign(new Error("db"), { code: "23505", constraint: "accounts_email_key" });
  assert.equal(mapAgentError(other).code, "23505");
});

test("a failed issue answers with a code the page knows, never a raw database code", () => {
  const code = (value) => Object.assign(new Error("db"), { code: value });
  assert.deepEqual(agentIssueError(code("KN002")), { status: 409, error: "agent_slots_full" });
  assert.deepEqual(agentIssueError(code("KN003")), { status: 403, error: "bad_owner" });
  assert.deepEqual(agentIssueError(code("KN001")), { status: 403, error: "users_full" });
  assert.deepEqual(agentIssueError(code("bad_name")), { status: 400, error: "bad_name" });
  // 认不出来的错误不外泄，也不假装成功。
  assert.deepEqual(agentIssueError(code("42P01")), { status: 503, error: "agent_unavailable" });
  assert.deepEqual(agentIssueError(new Error("boom")), { status: 503, error: "agent_unavailable" });
});

test("creating an agent writes one row under the owner and keeps the code out of the row", async () => {
  const pool = fakePool((sql, params) => {
    if (sql.includes("INSERT INTO accounts")) {
      return { rows: [{ id: AGENT, display_name: params[1], created_at: "t" }] };
    }
    throw new Error(sql);
  });
  const issued = await createAgent(pool, { ownerId: OWNER, name: " 豆包 ", specialties: ["网页搜索"] });
  assert.equal(issued.displayName, "豆包");
  assert.equal(issued.created, true);
  const insert = pool.calls[0];
  assert.match(insert.sql, /role, owner_id, display_name, token_hash, specialties/);
  assert.deepEqual(insert.params.slice(0, 2), [OWNER, "豆包"]);
  assert.equal(insert.params[2], hashAgentToken(issued.token));
  assert.equal(insert.params[3], JSON.stringify(["网页搜索"]));
  assert.equal(JSON.stringify(insert.params).includes(issued.token), false);
});

test("rotating retires nothing and refuses an unknown agent", async () => {
  const pool = fakePool(() => ({ rows: [{ id: AGENT, display_name: "豆包", created_at: "t" }] }));
  const rotated = await rotateAgentToken(pool, AGENT);
  assert.equal(rotated.created, false);
  assert.equal(pool.calls[0].params[0], AGENT);
  assert.equal(pool.calls[0].params[1], hashAgentToken(rotated.token));

  const closed = fakePool(() => ({ rows: [] }));
  await assert.rejects(rotateAgentToken(closed, AGENT), (error) => error.code === "not_found");
});

test("retiring clears the code and keeps the row", async () => {
  const pool = fakePool(() => ({ rows: [{ id: AGENT, owner_id: OWNER, display_name: "豆包" }] }));
  const retired = await retireAgent(pool, AGENT);
  assert.equal(retired.id, AGENT);
  assert.match(pool.calls[0].sql, /token_hash = NULL/);
  assert.match(pool.calls[0].sql, /retired_at = now\(\)/);
});

test("reviving keeps the identity and takes a fresh code", async () => {
  const pool = fakePool(() => ({ rows: [{ id: AGENT, display_name: "豆包", created_at: "t" }] }));
  const revived = await reviveAgent(pool, AGENT, ["资料整理"]);
  assert.equal(revived.created, false);
  assert.equal(pool.calls[0].params[0], AGENT);
  assert.equal(pool.calls[0].params[1], hashAgentToken(revived.token));
  assert.equal(pool.calls[0].params[2], JSON.stringify(["资料整理"]));
  assert.match(pool.calls[0].sql, /retired_at = NULL/);
});

test("an external account with a live agent only gets a new code", async () => {
  const pool = fakePool((sql) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (/owner_id = \$1 AND role = 'agent'\s+AND retired_at IS NULL/.test(sql)) {
      return { rows: [{ id: AGENT, retired_at: null, has_token: true }] };
    }
    if (sql.includes("token_hash = $2")) return { rows: [{ id: AGENT, display_name: "甲 的 Agent", created_at: "t" }] };
    throw new Error(sql);
  });
  const issued = await ensurePersonalAgent(pool, { id: OWNER, display_name: "甲" });
  assert.equal(issued.id, AGENT);
  assert.equal(issued.created, false);
  assert.equal(pool.calls.some((call) => call.sql.includes("INSERT INTO accounts")), false);
});

test("两个并发取码在同一把锁里排队，先返回的令牌不会被第二次换码顶掉", async () => {
  const events = [];
  // 一把互斥：后到的事务在咨询锁上等前一个 COMMIT，模拟 pg_advisory_xact_lock。
  let tail = Promise.resolve();
  const pool = {
    async connect() {
      const client = {
        release() {},
        done: null,
        async query(sql) {
          const text = String(sql).trim();
          events.push(text);
          if (text === "BEGIN") return { rows: [] };
          if (text === "COMMIT" || text === "ROLLBACK") {
            client.done?.();
            return { rows: [] };
          }
          if (sql.includes("pg_advisory_xact_lock")) {
            const previous = tail;
            tail = new Promise((resolve) => {
              client.done = resolve;
            });
            await previous;
            return { rows: [] };
          }
          if (/owner_id = \$1 AND role = 'agent'\s+AND retired_at IS NULL/.test(sql)) return { rows: [{ id: AGENT }] };
          if (sql.includes("token_hash = $2")) {
            return { rows: [{ id: AGENT, display_name: "甲 的 Agent", created_at: "t" }] };
          }
          throw new Error(sql);
        },
      };
      return client;
    },
  };
  const [first, second] = await Promise.all([
    ensurePersonalAgent(pool, { id: OWNER, display_name: "甲" }),
    ensurePersonalAgent(pool, { id: OWNER, display_name: "甲" }),
  ]);
  assert.equal(first.id, AGENT);
  assert.notEqual(first.token, second.token);
  // 第一步就是 BEGIN：在岗行不能在事务外先查。旧写法第一句是 findAgentsOf 的 SELECT。
  assert.equal(events[0], "BEGIN");
  const lock = events.findIndex((sql) => sql.includes("pg_advisory_xact_lock"));
  const lookup = events.findIndex((sql) => /owner_id = \$1 AND role = 'agent'/.test(sql));
  assert.ok(lock > 0 && lookup > lock, `在岗查询必须落在锁内: ${events.join(" | ")}`);
  // 第二次换码发生在前一次 COMMIT 之后：两笔换码不交叠，返回的令牌各有一次明文。
  const rotates = events.flatMap((sql, index) => (sql.includes("token_hash = $2") ? [index] : []));
  assert.equal(rotates.length, 2);
  const commits = events.flatMap((sql, index) => (sql === "COMMIT" ? [index] : []));
  assert.equal(commits.length, 2);
  assert.ok(rotates[0] < commits[0] && commits[0] < rotates[1]);
});

test("an external account without an agent creates exactly one, named after the person", async () => {
  const pool = fakePool((sql, params) => {
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (/owner_id = \$1 AND role = 'agent'\s+AND retired_at IS NULL/.test(sql)) return { rows: [] };
    if (sql.includes("retired_at IS NOT NULL")) return { rows: [] };
    if (sql.includes("INSERT INTO accounts")) {
      return { rows: [{ id: AGENT, display_name: params[1], created_at: "t" }] };
    }
    throw new Error(sql);
  });
  const issued = await ensurePersonalAgent(pool, { id: OWNER, display_name: "甲" });
  assert.equal(issued.displayName, "甲 的 Agent");
  assert.equal(issued.created, true);
  assert.ok(pool.calls.some((call) => call.sql.trim() === "COMMIT"));
});

test("listing an owner's agents can include the retired ones", async () => {
  const pool = fakePool(() => ({ rows: [{ id: AGENT, retired_at: "t" }] }));
  await findAgentsOf(pool, OWNER, { includeRetired: true });
  assert.match(pool.calls[0].sql, /owner_id = \$1/);
  assert.equal(pool.calls[0].sql.includes("retired_at IS NULL"), false);

  await findAgentsOf(pool, OWNER);
  assert.match(pool.calls[1].sql, /retired_at IS NULL/);
});

test("the env file keeps a safe name, is written once, and is readable only by the owner", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-"));
  const file = await writeAgentEnvFile(dir, { id: AGENT, ownerId: OWNER, displayName: "豆包 / 搜索", token: "secret" });
  assert.equal(file, agentEnvPath(dir, "豆包 / 搜索"));
  assert.equal(path.basename(file), "豆包_搜索.local.env");
  const text = await readFile(file, "utf8");
  assert.match(text, /KNOT_AGENT_TOKEN=secret/);
  assert.match(text, new RegExp(`KNOT_AGENT_ID=${AGENT}`));
  assert.match(text, new RegExp(`KNOT_AGENT_OWNER_ID=${OWNER}`));
  const mode = (await stat(file)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test("两个称呼转成同一个文件名时不互相覆盖", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-clash-"));
  const first = "44444444-4444-4444-8444-444444444444";
  const second = "55555555-5555-4555-8555-555555555555";
  const one = await writeAgentEnvFile(dir, { id: first, displayName: "豆包 / 搜索", token: "one" });
  const two = await writeAgentEnvFile(dir, { id: second, displayName: "豆包_搜索", token: "two" });
  assert.equal(path.basename(one), "豆包_搜索.local.env");
  assert.equal(path.basename(two), `豆包_搜索.${second.slice(0, 8)}.local.env`);
  // 先写的那个人的授权码还在原处，没有被后写的顶掉。
  assert.match(await readFile(one, "utf8"), new RegExp(`KNOT_AGENT_ID=${first}[\\s\\S]*KNOT_AGENT_TOKEN=one`));
  assert.match(await readFile(two, "utf8"), /KNOT_AGENT_TOKEN=two/);
  // 同一个 Agent 再写一次，用的还是它自己那份文件。
  assert.equal(await agentEnvFileFor(dir, { id: second, displayName: "豆包_搜索" }), two);
  assert.equal(await agentEnvFileFor(dir, { id: first, displayName: "豆包 / 搜索" }), one);
});

test("改称呼只改授权码文件里的名字，文件名与令牌不动", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-rename-"));
  const id = "66666666-6666-4666-8666-666666666666";
  const file = await writeAgentEnvFile(dir, { id, displayName: "豆包", token: "secret" });
  // OpenClaw 的 apply-config 按签发时的称呼找 `<称呼>.local.env`，所以文件不搬。
  const same = await updateAgentEnvName(dir, { id, displayName: "豆包二号" });
  assert.equal(same, file);
  assert.equal(path.basename(same), "豆包.local.env");
  const text = await readFile(same, "utf8");
  assert.match(text, /^KNOT_AGENT_NAME=豆包二号$/m);
  assert.match(text, /^KNOT_AGENT_TOKEN=secret$/m);
  assert.equal((await stat(same)).mode & 0o777, 0o600);
  // 改过名字之后再停用，也要按 id 认出这份文件带走。
  assert.equal(await removeAgentEnvFile(dir, { id, displayName: "豆包二号" }), true);
  assert.equal(existsSync(same), false);
});

test("停用时带走自己那份授权码，不碰别人的", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-remove-"));
  const first = "44444444-4444-4444-8444-444444444444";
  const second = "55555555-5555-4555-8555-555555555555";
  const one = await writeAgentEnvFile(dir, { id: first, displayName: "豆包 / 搜索", token: "one" });
  const two = await writeAgentEnvFile(dir, { id: second, displayName: "豆包_搜索", token: "two" });
  assert.equal(await removeAgentEnvFile(dir, { id: second, displayName: "豆包_搜索" }), true);
  assert.equal(await removeAgentEnvFile(dir, { id: second, displayName: "豆包_搜索" }), false);
  assert.equal(existsSync(two), false);
  assert.equal(existsSync(one), true);
});
