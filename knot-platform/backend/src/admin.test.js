import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import {
  adminDoorAddress,
  bearerToken,
  clipText,
  hoursWithin,
  isIntranetAddress,
  isLoopbackAddress,
  grantPoints,
  issueInternalAgent,
  listAccountRoster,
  listPosts,
  muteUser,
  patrolQueue,
  recordPatrol,
  removePost,
  readManagedAgentToken,
  retireManagedAgent,
  rotateManagedAgentToken,
  setEntitlements,
  setLevel,
  tokensMatch,
  unmuteUser,
  updateManagedAccount,
  warnUser,
} from "./admin.js";
import { muteState, speakerAccount } from "./account.js";
import { createProfileStore } from "./profile.js";
import { adminRouter, tunnelLocalPort } from "./routes/admin.js";
import { installSystemPolicy, resetSystemPolicy } from "./system.js";

// 管理员邮箱现在必须来自配置；这个文件里签发的内部账户共用这个测试值。
process.env.KNOT_ADMIN_EMAIL = process.env.KNOT_ADMIN_EMAIL || "admin@example.com";

const POST_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "11111111-1111-4111-8111-111111111111";

// 会开事务的写操作先 pool.connect() 再发语句。假池把同一个 query 交给「客户端」，
// 事务控制语句不进调用记录：断言看到的仍是业务语句，顺序与原来一致。
const TX_SQL = new Set(["BEGIN", "COMMIT", "ROLLBACK"]);
function poolWithClient(query) {
  const run = (sql, params) =>
    TX_SQL.has(String(sql).trim()) ? Promise.resolve({ rows: [] }) : query(sql, params);
  return {
    query: run,
    async connect() {
      return { query: run, release() {} };
    },
  };
}

test("loopback is the machine itself", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.10"), false);
  assert.equal(bearerToken("Bearer secret"), "secret");
  assert.equal(tokensMatch("secret", "secret"), true);
  assert.equal(tokensMatch("secret", "other"), false);
  assert.equal(tokensMatch("", ""), false);
  assert.equal(clipText("  a   b  ", 10), "a b");
});

test("the tunnel lands on the port the backend listens on", () => {
  // 接上 XKnot 之后对外 origin 是 https://<子域>，没有端口；不能从它猜出 443。
  assert.equal(tunnelLocalPort(8081), 8081);
  assert.equal(tunnelLocalPort(0, { PORT: "9090" }), 9090);
  assert.equal(tunnelLocalPort(undefined, {}), 8080);
  assert.equal(tunnelLocalPort(-1, {}), 8080);
});

test("the admin door opens to the intranet, never to the public", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isIntranetAddress(address), true, address);
  }
  for (const address of [
    "192.168.1.10",
    "10.1.2.3",
    "172.16.0.9",
    "172.31.255.254",
    "169.254.10.4",
    "::ffff:192.168.1.10",
    "fd00::12",
    "fe80::1%en0",
  ]) {
    assert.equal(isIntranetAddress(address), true, address);
  }
  for (const address of [
    "8.8.8.8",
    "172.15.0.1",
    "172.32.0.1",
    "203.0.113.9",
    "2001:db8::1",
    "2606:4700::1111",
    "",
    "not-an-address",
  ]) {
    assert.equal(isIntranetAddress(address), false, address);
  }
});

test("remove records the reason and tells the author", async () => {
  const calls = [];
  const pool = poolWithClient(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("UPDATE intel")) return { rows: [{ id: params[0], account_id: USER_ID }] };
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await removePost(pool, POST_ID, "含有欺诈内容。");
  assert.equal(result.already, false);
  assert.equal(result.userId, USER_ID);
  assert.match(calls[0].sql, /verdict = 'removed'/);
  assert.equal(calls[0].params[1], "含有欺诈内容。");
  assert.equal(calls[1].params[1], "intel_removed");
  assert.equal(calls[1].params[2], "帖子已删除");
  assert.deepEqual(JSON.parse(calls[1].params[6]), { reason: "含有欺诈内容。" });
  assert.match(calls[2].sql, /admin_actions/);
  assert.equal(calls[2].params[0], "remove");
});

test("a web close records which human admin did it", async () => {
  const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls = [];
  const pool = poolWithClient(async (sql, params) => {
    calls.push({ sql, params });
    if (sql.includes("UPDATE intel")) return { rows: [{ id: params[0], account_id: USER_ID }] };
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  await removePost(pool, POST_ID, "平台关闭", { actorId: ADMIN_ID, platformClosed: true });
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.match(action.sql, /actor_account_id/);
  assert.equal(action.params[0], "remove");
  assert.equal(action.params[1], USER_ID);
  assert.equal(action.params[4], ADMIN_ID);
  // 没有填写原因时，WebUI 显示「平台关闭」这句平台话，而不是把中文原文照搬。
  const notice = calls.find((call) => call.sql.includes("INSERT INTO notifications"));
  assert.deepEqual(JSON.parse(notice.params[6]), { platformClosed: true });
});

test("a second remove of the same post stays quiet", async () => {
  let updates = 0;
  const pool = poolWithClient(async (sql) => {
    if (sql.includes("UPDATE intel")) {
      updates += 1;
      return { rows: [] };
    }
    if (sql.includes("verdict = 'removed'")) return { rows: [{ id: POST_ID }] };
    return { rows: [] };
  });
  const result = await removePost(pool, POST_ID, "含有欺诈内容。");
  assert.equal(result.already, true);
  assert.equal(updates, 1);
});

test("removing one revision takes the whole chain down, old versions included", async () => {
  const V1 = "33333333-3333-4333-8333-333333333333";
  const calls = [];
  const pool = poolWithClient(async (sql, params) => {
    calls.push({ sql, params });
    // 新版与旧版同属一条链：一条 UPDATE 一起改，返回两行。
    if (sql.includes("UPDATE intel")) {
      return { rows: [{ id: V1, account_id: USER_ID }, { id: POST_ID, account_id: USER_ID }] };
    }
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await removePost(pool, POST_ID, "含有欺诈内容。");
  assert.equal(result.already, false);
  assert.equal(result.userId, USER_ID);
  const update = calls.find((call) => call.sql.includes("UPDATE intel"));
  // 条件认的是被点那一版所属的链，不是它自己的 id：否则 v2 撤下后 v1 会回到信息流。
  assert.match(update.sql, /COALESCE\(origin_id, id\) = \(SELECT COALESCE\(origin_id, id\) FROM intel WHERE id = \$1\)/);
  assert.deepEqual(update.params, [POST_ID, "含有欺诈内容。"]);
  // 作者只收一条通知，不按版本重复发。
  assert.equal(calls.filter((call) => call.sql.includes("INSERT INTO notifications")).length, 1);
});

test("a failed audit write rolls the removal back", async () => {
  const tx = [];
  const pool = {
    async query() {
      return { rows: [] };
    },
    async connect() {
      return {
        async query(sql) {
          const text = String(sql).trim();
          if (text === "BEGIN" || text === "COMMIT" || text === "ROLLBACK") {
            tx.push(text);
            return { rows: [] };
          }
          if (text.includes("UPDATE intel")) return { rows: [{ id: POST_ID, account_id: USER_ID }] };
          if (text.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
          if (text.includes("INSERT INTO admin_actions")) throw new Error("audit_down");
          return { rows: [] };
        },
        release() {
          tx.push("release");
        },
      };
    },
  };
  // 帖、通知、流水同进同退：流水写不进去，撤下与通知一起回滚，管理员重试即可。
  await assert.rejects(() => removePost(pool, POST_ID, "含有欺诈内容。"), /audit_down/);
  assert.deepEqual(tx, ["BEGIN", "ROLLBACK", "release"]);
});

test("patrol moves its window to the last post it covered", async () => {
  const COVERED = "44444444-4444-4444-8444-444444444444";
  const seen = [];
  const pool = poolWithClient(async (sql, params) => {
    seen.push({ sql, params });
    if (sql.includes("verdict = 'passed'")) {
      return {
        rows: [{ id: COVERED, body: "一", created_at: new Date(), account_id: USER_ID, email: "a@example.com", display_name: "甲" }],
      };
    }
    return { rows: [{ id: COVERED }] };
  });
  const queue = await patrolQueue(pool);
  assert.equal(queue.posts.length, 1);
  // 水位由「上一轮看到的最后一条」推进，不再用报告提交时刻。
  assert.equal(queue.through, COVERED);
  assert.match(seen[0].sql, /a\.action = 'patrol' AND a\.intel_id IS NOT NULL/);
  assert.match(seen[0].sql, /covered\.created_at/);

  await recordPatrol(pool, "未发现违规。", queue.through);
  const action = seen.find((item) => item.sql.includes("INSERT INTO admin_actions"));
  assert.equal(action.params[0], "patrol");
  assert.equal(action.params[2], COVERED);
});

test("a patrol report cannot point its window at nothing", async () => {
  const pool = poolWithClient(async () => ({ rows: [] }));
  await assert.rejects(() => recordPatrol(pool, "未发现。", "not-a-uuid"), (error) => error.code === "bad_args");
  await assert.rejects(() => recordPatrol(pool, "未发现。", POST_ID), (error) => error.code === "not_found");
});

test("grant adds the amount once and tells the person", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] };
      if (sql.includes("COALESCE(owner_id, id)")) return { rows: [{ wallet: params[0] }] };
      if (sql.includes("UPDATE accounts")) return { rows: [{ points_balance: 150 }] };
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM accounts")) {
        return {
          rows: [{ id: USER_ID, email: "a@example.com", display_name: "甲", label: "tester", points_balance: 100 }],
        };
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };
  const result = await grantPoints(pool, "a@example.com", 50, "补偿一次失败的下载。");
  assert.equal(result.ok, true);
  assert.equal(result.amount, 50);
  assert.equal(result.pointsBalance, 150);
  assert.equal(result.user.id, USER_ID);
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.equal(action.params[0], USER_ID);
  assert.equal(action.params[1], "到账 50。补偿一次失败的下载。");
  const ledger = calls.find((call) => call.sql.includes("point_ledger"));
  assert.deepEqual(ledger.params, [USER_ID, 50, "grant", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]);
  const note = calls.find((call) => call.sql.includes("notifications"));
  assert.equal(note.params[1], "points_granted");
  assert.equal(note.params[2], "积分已到账");
  assert.equal(note.params[4], "/mine");
  assert.equal(calls.at(-1).sql, "COMMIT");
});

test("the same grant submitted twice within the window credits once", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      // 第二次提交时窗口里已经有同一笔：不再插流水、不再加钱。
      if (sql.includes("FROM admin_actions") && sql.includes("interval '10 minutes'")) {
        return { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] };
      }
      if (sql.includes("SELECT points_balance")) return { rows: [{ points_balance: "150" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM accounts")) {
        return {
          rows: [{ id: USER_ID, email: "a@example.com", display_name: "甲", label: "tester", points_balance: 100 }],
        };
      }
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };

  const result = await grantPoints(pool, "a@example.com", 50, "补偿一次失败的下载。");
  assert.equal(result.ok, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.pointsBalance, 150);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO admin_actions")), false);
  assert.equal(calls.some((call) => call.sql.includes("point_ledger")), false);
  assert.equal(calls.at(-1).sql, "COMMIT");
});

// 带幂等键的发放：键相同就是同一笔，键不同就是另一笔。
function grantPool({ calls, replay = false, insertFails = null }) {
  return poolWithClient(async (sql, params) => {
    calls.push({ sql, params });
    // 顺序有讲究：walletOf 与 oneUser 都查 accounts，先认特征更强的那条。
    if (sql.includes("SELECT points_balance")) return { rows: [{ points_balance: "150" }] };
    if (sql.includes("COALESCE(owner_id, id)")) return { rows: [{ wallet: params[0] }] };
    if (sql.includes("SELECT id FROM admin_actions") && sql.includes("request_id")) {
      return { rows: replay ? [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] : [] };
    }
    if (sql.includes("INSERT INTO admin_actions")) {
      if (insertFails) throw Object.assign(new Error(insertFails), { code: "23505", constraint: insertFails });
      return { rows: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }] };
    }
    if (sql.includes("FROM accounts")) {
      return { rows: [{ id: USER_ID, email: "a@example.com", display_name: "甲", label: "tester", points_balance: 100 }] };
    }
    if (sql.includes("UPDATE accounts")) return { rows: [{ points_balance: 150 }] };
    if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
}

test("同一个幂等键重试只记一笔，键本身写进流水", async () => {
  const calls = [];
  const result = await grantPoints(grantPool({ calls, replay: true }), "a@example.com", 50, "补偿。", "req-abc-1234");
  assert.equal(result.duplicate, true);
  assert.equal(result.pointsBalance, 150);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO admin_actions")), false);
  assert.equal(calls.some((call) => call.sql.includes("point_ledger")), false);
});

test("换了键的同金额同理由照常发第二笔，不再按内容猜重放", async () => {
  const calls = [];
  const result = await grantPoints(grantPool({ calls }), "a@example.com", 50, "补偿。", "req-abc-5678");
  assert.equal(result.duplicate, undefined);
  assert.equal(result.pointsBalance, 150);
  const insert = calls.find((call) => call.sql.includes("INSERT INTO admin_actions"));
  assert.equal(insert.params[2], "req-abc-5678");
  // 走了键的分支就不该再查那个 10 分钟窗口。
  assert.equal(calls.some((call) => call.sql.includes("interval '10 minutes'")), false);
});

test("幂等键格式不对时直接拒，不落账", async () => {
  const calls = [];
  const pool = grantPool({ calls });
  await assert.rejects(grantPoints(pool, "a@example.com", 50, "补偿。", "../../etc/passwd"), (error) => error.code === "bad_request_id");
  assert.equal(calls.length, 0);
});

test("并发撞上唯一索引时按重复处理，不冒 500", async () => {
  const calls = [];
  const result = await grantPoints(
    grantPool({ calls, insertFails: "admin_actions_request_id_idx" }),
    "a@example.com",
    50,
    "补偿。",
    "req-abc-9012"
  );
  assert.equal(result.duplicate, true);
});

test("a grant needs one account, a positive amount, and a reason", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM accounts")) {
        return {
          rows: [
            { id: USER_ID, email: "a@example.com", display_name: "甲", label: null, points_balance: 1 },
            { id: POST_ID, email: "b@example.com", display_name: "甲", label: null, points_balance: 2 },
          ],
        };
      }
      throw new Error("unexpected query");
    },
    async connect() {
      throw new Error("should not grant");
    },
  };
  await assert.rejects(grantPoints(pool, "甲", 10, "补偿"), (error) => error.code === "ambiguous");
  const closed = {
    async query() {
      throw new Error("should not look up");
    },
    async connect() {
      throw new Error("should not grant");
    },
  };
  await assert.rejects(grantPoints(closed, "a@example.com", 0, "补偿"), (error) => error.code === "bad_amount");
  await assert.rejects(grantPoints(closed, "a@example.com", -5, "补偿"), (error) => error.code === "bad_amount");
  await assert.rejects(grantPoints(closed, "a@example.com", 1.5, "补偿"), (error) => error.code === "bad_amount");
  await assert.rejects(grantPoints(closed, "a@example.com", 100001, "补偿"), (error) => error.code === "bad_amount");
  await assert.rejects(grantPoints(closed, "a@example.com", 10, "  "), (error) => error.code === "bad_body");
});

const PERSON = {
  id: USER_ID,
  email: "a@example.com",
  display_name: "甲",
  label: "",
  level: 1,
  entitlements: {},
  points_balance: 100,
  muted_until: null,
};

function accountPool(user, onClient) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
      return onClient(sql, params);
    },
    release() {},
  };
  return {
    calls,
    pool: {
      async query(sql) {
        if (sql.includes("FROM accounts")) return { rows: [user] };
        throw new Error(sql);
      },
      async connect() {
        return client;
      },
    },
  };
}

test("mute blocks new speech until the deadline", async () => {
  assert.equal(muteState(null).muted, false);
  assert.equal(muteState(new Date(Date.now() - 1000)).muted, false);
  assert.equal(muteState(new Date("9999-12-31T00:00:00.000Z")).mutedUntil, null);
  assert.equal(muteState(new Date("9999-12-31T00:00:00.000Z")).muted, true);

  const { calls, pool } = accountPool(PERSON, (sql, params) => {
    if (sql.includes("FOR UPDATE")) return { rows: [PERSON] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ ...PERSON, muted_until: params[1] }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await muteUser(pool, "a@example.com", "forever", "请停止骚扰。");
  assert.equal(result.user.muted, true);
  assert.equal(result.user.mutedUntil, null);
  const note = calls.find((call) => call.sql.includes("notifications"));
  assert.equal(note.params[1], "muted");
  assert.equal(note.params[2], "已被禁言");
  assert.match(note.params[3], /^禁言，直到平台解除。请停止骚扰。/);
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.match(action.sql, /'mute'/);

  const timed = accountPool(PERSON, (sql, params) => {
    if (sql.includes("FOR UPDATE")) return { rows: [PERSON] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ ...PERSON, muted_until: params[1] }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const week = await muteUser(timed.pool, "a@example.com", "7d", "请停止骚扰。");
  assert.equal(week.user.muted, true);
  // 期限要真的落在七天附近：只断「非空」时，把 7d 错算成 7 小时也能过（S13-09）。
  const days = (new Date(week.user.mutedUntil).getTime() - Date.now()) / 86_400_000;
  assert.ok(days > 6.9 && days < 7.1, `expected about 7 days, got ${days}`);

  const closed = {
    async query() {
      throw new Error("should not look up");
    },
    async connect() {
      throw new Error("should not mute");
    },
  };
  await assert.rejects(muteUser(closed, "a@example.com", "", "原因"), (error) => error.code === "bad_until");
  await assert.rejects(muteUser(closed, "a@example.com", "半年", "原因"), (error) => error.code === "bad_until");
  await assert.rejects(
    muteUser(
      {
        async query() {
          return { rows: [{ ...PERSON, role: "platform" }] };
        },
        async connect() {
          throw new Error("should not mute");
        },
      },
      "knot",
      "7d",
      "原因"
    ),
    (error) => error.code === "protected"
  );
});

test("unmute is quiet when the account can already speak", async () => {
  const quiet = {
    async query() {
      return { rows: [PERSON] };
    },
    async connect() {
      throw new Error("should not unmute");
    },
  };
  const skipped = await unmuteUser(quiet, "a@example.com", "可以了。");
  assert.equal(skipped.already, true);

  const muted = { ...PERSON, muted_until: new Date("9999-12-31T00:00:00.000Z") };
  const { calls, pool } = accountPool(muted, (sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [muted] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ ...PERSON, muted_until: null }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await unmuteUser(pool, "a@example.com", "可以了。");
  assert.equal(result.already, false);
  assert.equal(result.user.muted, false);
  assert.equal(calls.find((call) => call.sql.includes("notifications")).params[1], "unmuted");
});

test("honors are granted and revoked by the names given", async () => {
  const held = { ...PERSON, entitlements: { honors: ["早期用户"] } };
  const { calls, pool } = accountPool(held, (sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [held] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ ...held, entitlements: { honors: ["早期用户", "审稿"] } }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await setEntitlements(pool, "a@example.com", ["审稿", "早期用户"], [], "感谢长期供稿。");
  assert.deepEqual(result.granted, ["审稿"]);
  assert.deepEqual(result.revoked, []);
  assert.deepEqual(result.user.entitlements, ["早期用户", "审稿"]);
  const saved = calls.find((call) => call.sql.includes("UPDATE accounts"));
  assert.equal(saved.params[1], JSON.stringify(["早期用户", "审稿"]));
  assert.equal(calls.find((call) => call.sql.includes("notifications")).params[2], "权益已更新");

  const full = { ...PERSON, entitlements: { honors: ["一", "二", "三", "四", "五", "六", "七", "八"] } };
  await assert.rejects(
    setEntitlements(
      accountPool(full, (sql) => {
        if (sql.includes("FOR UPDATE")) return { rows: [full] };
        throw new Error(sql);
      }).pool,
      "a@example.com",
      ["九"],
      [],
      "太多了。"
    ),
    (error) => error.code === "entitlement_full"
  );
  const closed = {
    async query() {
      throw new Error("should not look up");
    },
  };
  await assert.rejects(setEntitlements(closed, "a@example.com", ["、"], [], "原因"), (error) => error.code === "bad_entitlement");
  await assert.rejects(setEntitlements(closed, "a@example.com", ["甲"], ["甲"], "原因"), (error) => error.code === "bad_entitlement");
  await assert.rejects(setEntitlements(closed, "a@example.com", [], [], "原因"), (error) => error.code === "bad_entitlement");
});

test("level changes once and leaves the platform account alone", async () => {
  const same = {
    async query() {
      return { rows: [{ ...PERSON, level: 2 }] };
    },
    async connect() {
      throw new Error("should not change");
    },
  };
  const skipped = await setLevel(same, "a@example.com", 2, "维持。");
  assert.equal(skipped.already, true);

  const { calls, pool } = accountPool(PERSON, (sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [PERSON] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ ...PERSON, level: 3 }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await setLevel(pool, "a@example.com", 3, "供稿稳定。");
  assert.equal(result.user.level, 3);
  assert.equal(calls.find((call) => call.sql.includes("notifications")).params[1], "level_changed");
  assert.match(calls.find((call) => call.sql.includes("admin_actions")).sql, /'level'/);

  const closed = {
    async query() {
      throw new Error("should not look up");
    },
  };
  await assert.rejects(setLevel(closed, "a@example.com", 0, "原因"), (error) => error.code === "bad_level");
  await assert.rejects(setLevel(closed, "a@example.com", 101, "原因"), (error) => error.code === "bad_level");
  await assert.rejects(
    setLevel(
      {
        async query() {
          return { rows: [{ ...PERSON, role: "platform" }] };
        },
        async connect() {
          throw new Error("should not change");
        },
      },
      "knot",
      2,
      "原因"
    ),
    (error) => error.code === "protected"
  );
});

test("speech stops while a mute is in force", async () => {
  await assert.rejects(
    speakerAccount(
      {
        async query() {
          return { rows: [{ muted_until: new Date(Date.now() + 60_000) }] };
        },
      },
      USER_ID
    ),
    (error) => error.code === "muted"
  );
  await speakerAccount(
    {
      async query() {
        return { rows: [{ muted_until: new Date(Date.now() - 60_000) }] };
      },
    },
    USER_ID
  );
});

test("an agent goes quiet when the account it belongs to is muted", async () => {
  // 禁言落在账号上，换个门从 Agent 发也一样停。
  await assert.rejects(
    speakerAccount(
      {
        async query() {
          return { rows: [{ muted_until: null, owner_muted_until: new Date(Date.now() + 60_000) }] };
        },
      },
      USER_ID
    ),
    (error) => error.code === "muted"
  );
});

test("a warning needs one account", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM accounts")) {
        return {
          rows: [
            { id: USER_ID, email: "a@example.com", display_name: "甲", label: null },
            { id: POST_ID, email: "b@example.com", display_name: "甲", label: null },
          ],
        };
      }
      return { rows: [] };
    },
  };
  await assert.rejects(warnUser(pool, "甲", "请停止骚扰。"), (error) => error.code === "ambiguous");
});

test("listing posts stays on that one account", async () => {
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push(params);
      if (sql.includes("FROM accounts")) {
        return { rows: [{ id: USER_ID, email: "a@example.com", display_name: "甲", label: "tester" }] };
      }
      return { rows: [{ id: POST_ID, body: "一条帖子", verdict: "passed", is_public: true, created_at: "t" }] };
    },
  };
  const result = await listPosts(pool, { user: "a@example.com", q: "帖子" });
  assert.equal(result.user.id, USER_ID);
  assert.equal(result.within, null);
  assert.equal(result.posts[0].id, POST_ID);
  assert.equal(seen[1][0], USER_ID);
  assert.equal(seen[1].at(-1), 30);
});

test("a time window lists that person's posts since then", async () => {
  assert.deepEqual(hoursWithin("7d"), { hours: 168, within: "7d" });
  assert.deepEqual(hoursWithin("24H"), { hours: 24, within: "24h" });
  assert.deepEqual(hoursWithin("2w"), { hours: 336, within: "2w" });
  assert.equal(hoursWithin(""), null);
  assert.throws(() => hoursWithin("半年"), (error) => error.code === "bad_within");
  assert.throws(() => hoursWithin("400d"), (error) => error.code === "bad_within");

  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (sql.includes("FROM accounts")) {
        return { rows: [{ id: USER_ID, email: "a@example.com", display_name: "甲", label: "" }] };
      }
      return {
        rows: [
          { id: POST_ID, body: "一条帖子", verdict: "passed", is_public: true, created_at: "t", total: 2 },
        ],
      };
    },
  };
  const result = await listPosts(pool, { user: USER_ID, within: "7d" });
  assert.equal(result.within, "7d");
  assert.equal(result.total, 2);
  assert.match(seen[1].sql, /make_interval/);
  assert.equal(seen[1].params[1], 168);
  assert.equal(seen[1].params.at(-1), 200);
});

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("profile: saving returns the issued side too, and says so when it cannot write", async () => {
  // PUT 只回自述区时，页面拿它重画会把签发区与「已接入」一起抹掉。
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-admin-profile-"));
  const store = createProfileStore({ file: path.join(dir, "profile.json") });
  const withProfile = express();
  withProfile.use(express.json());
  withProfile.use(
    "/api/admin",
    adminRouter({ pool: { query: async () => ({ rows: [] }) }, token: "secret", profile: store, port: 8081 })
  );
  const server = await listen(withProfile);
  try {
    const port = server.address().port;
    const saved = await fetch(`http://127.0.0.1:${port}/api/admin/profile`, {
      method: "PUT",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ site: { name: "cpswang" } }),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.site.name, "cpswang");
    assert.ok(body.issued, "the save response must carry the issued side");
    assert.equal(typeof body.issued, "object");
    assert.ok("file" in body);
  } finally {
    server.close();
  }

  // 没有站点目录：明确的 503，不是 500 internal。
  const bare = express();
  bare.use(express.json());
  bare.use("/api/admin", adminRouter({ pool: { query: async () => ({ rows: [] }) }, token: "secret" }));
  const server2 = await listen(bare);
  try {
    const port = server2.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/profile`, {
      method: "PUT",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ site: { name: "cpswang" } }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "profile_unconfigured");
  } finally {
    server2.close();
  }
});

test("the admin door checks the token before it acts", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: { query: async () => ({ rows: [] }) }, token: "" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const open = await fetch(`http://127.0.0.1:${port}/api/admin/patrol`);
    assert.equal(open.status, 503);
  } finally {
    server.close();
  }

  const locked = express();
  locked.use(express.json());
  locked.use("/api/admin", adminRouter({ pool: { query: async () => ({ rows: [] }) }, token: "secret" }));
  const server2 = await listen(locked);
  try {
    const port = server2.address().port;
    const denied = await fetch(`http://127.0.0.1:${port}/api/admin/patrol`);
    assert.equal(denied.status, 401);
    const ok = await fetch(`http://127.0.0.1:${port}/api/admin/patrol`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { posts: [], through: null });
    const rejected = await fetch(`http://127.0.0.1:${port}/api/admin/points`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ user: "a@example.com", amount: 0, body: "补偿" }),
    });
    assert.equal(rejected.status, 400);
    assert.deepEqual(await rejected.json(), { error: "bad_amount" });
  } finally {
    server2.close();
  }
});

test("the system door flips switches and records the change", async () => {
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql.includes("INSERT INTO system_policy")) {
      return {
        rows: [{
          guest_browsing: false,
          registration_mode: "open",
          public_board: false,
          updated_at: new Date("2026-10-19T00:00:00Z"),
        }],
      };
    }
    return { rows: [] };
  };
  // 配置与审计在同一事务里，路由会先 pool.connect()。
  const pool = { query, async connect() { return { query, release() {} }; } };
  installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: true });
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool, token: "secret" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/system`, {
      method: "PATCH",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ guestBrowsing: false }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.system.guestBrowsing, false);
    // 关掉站内浏览，公开快照一起关。
    assert.equal(body.system.publicBoard, false);
    assert.equal(body.system.registrationMode, "open");
    const audit = calls.find((call) => call.sql.includes("INSERT INTO admin_actions"));
    assert.equal(audit.params[0], "config");
    assert.equal(audit.params[1], "站内浏览、公开快照");

    const read = await fetch(`http://127.0.0.1:${port}/api/admin/system`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal((await read.json()).system.guestBrowsing, false);
  } finally {
    server.close();
    resetSystemPolicy();
  }
});

test("the invite door hands out a code and rejects a taken one", async () => {
  const query = async (sql, params = []) => {
    if (!sql.includes("INSERT INTO invite_codes")) return { rows: [] };
    if (params[0] === "TAKEN") {
      const error = new Error("duplicate key");
      error.code = "23505";
      throw error;
    }
    return {
      rows: [
        {
          id: "inv-1",
          code: params[0],
          note: params[1],
          max_uses: params[2],
          used_count: 0,
          expires_at: params[3],
          disabled_at: null,
          created_at: new Date("2026-10-19T00:00:00Z"),
        },
      ],
    };
  };
  // 签发与审计在同一事务里，路由会先 pool.connect()。
  const pool = { query, async connect() { return { query, release() {} }; } };
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool, token: "secret" }));
  const server = await listen(app);
  const post = (body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/admin/invites`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const created = await post({ code: "party 2026", maxUses: 2, note: "首批" });
    assert.equal(created.status, 201);
    const { invite } = await created.json();
    assert.equal(invite.code, "PARTY2026");
    assert.equal(invite.remaining, 2);
    assert.equal(invite.usable, true);

    const taken = await post({ code: "TAKEN" });
    assert.equal(taken.status, 409);
    assert.deepEqual(await taken.json(), { error: "code_taken" });
  } finally {
    server.close();
  }
});

test("the economy door hands back the three numbers and attention counters", async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin",
    adminRouter({
      pool: {
        // 账户余额与注意力计数走不同的语句，假池按语句回不同的数；
        // 全回同一行时 reads/searches 恒为 0，断言等于没断言（S13-09）。
        query: async (sql) => {
          if (sql.includes("intel_reads")) return { rows: [{ n: 12 }] };
          if (sql.includes("search_events")) return { rows: [{ n: 3 }] };
          return { rows: [{ total: "205", platform: "5" }] };
        },
      },
      token: "secret",
    })
  );
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/economy`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      issued: 205,
      circulating: 200,
      platform: 5,
      attention: { reads: 12, searches: 3 },
    });
  } finally {
    server.close();
  }
});

const OWNER_ID = "44444444-4444-4444-8444-444444444444";

const AGENT_ROW = {
  id: USER_ID,
  role: "agent",
  side: "internal",
  email: null,
  display_name: "豆包",
  owner_id: OWNER_ID,
  label: null,
  level: 1,
  entitlements: {},
  points_balance: 0,
  muted_until: null,
  specialties: ["网页搜索", "资料整理"],
  retired_at: null,
};

function issuePool({ existing = null, retireFails = false } = {}) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("role = 'owner'")) return { rows: [{ id: OWNER_ID }], rowCount: 1 };
      if (sql.includes("lower(btrim(display_name))")) {
        return existing ? { rows: [existing], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO accounts")) return { rows: [{ id: USER_ID, display_name: params[1], created_at: "t" }], rowCount: 1 };
      if (sql.includes("retired_at = NULL")) return { rows: [{ id: USER_ID, display_name: "豆包", created_at: "t" }], rowCount: 1 };
      if (sql.includes("retired_at = now()")) {
        return retireFails ? { rows: [], rowCount: 0 } : { rows: [{ id: USER_ID }], rowCount: 1 };
      }
      if (sql.includes("DELETE FROM accounts") || sql.includes("admin_actions")) return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT") && sql.includes("FROM accounts WHERE id = $1")) return { rows: [AGENT_ROW], rowCount: 1 };
      throw new Error(`unexpected ${sql}`);
    },
  };
  return { pool, calls };
}

test("issuing an internal agent writes the code once and leaves it out of the reply", async () => {
  const { pool, calls } = issuePool();
  let written;
  const result = await issueInternalAgent(pool, " 豆包 ", {
    envDir: "/tmp/knot-agents",
    specialties: [" 网页搜索 ", "网页搜索", "资料整理"],
    writeEnv: async (dir, issued) => {
      written = { dir, issued };
      return `${dir}/豆包.local.env`;
    },
  });
  assert.equal(written.dir, "/tmp/knot-agents");
  assert.equal(written.issued.displayName, "豆包");
  assert.match(written.issued.token, /^[A-Za-z0-9_-]+$/);
  const digest = createHash("sha256").update(written.issued.token).digest("hex");
  const insert = calls.find((call) => call.sql.includes("INSERT INTO accounts"));
  assert.equal(insert.params[0], OWNER_ID);
  assert.equal(insert.params[2], digest);
  assert.equal(insert.params[3], JSON.stringify(["网页搜索", "资料整理"]));
  // Agent 只落在 accounts 一行里：没有第二张关系表要写。
  assert.equal(calls.some((call) => /delegations/.test(call.sql)), false);
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.equal(action.params[0], USER_ID);
  assert.equal(action.params[1], "签发 豆包。特长 网页搜索、资料整理");
  assert.equal(result.created, true);
  assert.equal(result.issued, true);
  assert.equal(result.already, false);
  assert.equal(result.envFile, "/tmp/knot-agents/豆包.local.env");
  assert.equal(result.agent.id, USER_ID);
  assert.equal(result.agent.ownerId, OWNER_ID);
  assert.equal(JSON.stringify(result).includes(written.issued.token), false);
  assert.equal(action.params[1].includes(written.issued.token), false);
});

test("issuing the same name again leaves the working code alone", async () => {
  const { pool, calls } = issuePool({ existing: AGENT_ROW });
  let written = false;
  const result = await issueInternalAgent(pool, "豆包", {
    envDir: "/tmp/knot-agents",
    writeEnv: async () => {
      written = true;
    },
  });
  assert.equal(written, false);
  assert.equal(result.created, false);
  assert.equal(result.issued, false);
  assert.equal(result.already, true);
  assert.equal(result.envFile, null);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), false);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE accounts")), false);
});

test("a retired agent is revived under the same identity with a new code", async () => {
  const retired = { ...AGENT_ROW, retired_at: "yesterday" };
  const { pool, calls } = issuePool({ existing: retired });
  let written;
  const result = await issueInternalAgent(pool, "豆包", {
    envDir: "/tmp/knot-agents",
    specialties: ["资料整理"],
    writeEnv: async (dir, issued) => {
      written = issued;
      return `${dir}/豆包.local.env`;
    },
  });
  assert.equal(result.created, false);
  assert.equal(result.issued, true);
  assert.equal(result.already, false);
  assert.match(written.token, /^[A-Za-z0-9_-]+$/);
  const revive = calls.find((call) => call.sql.includes("retired_at = NULL"));
  assert.deepEqual(revive.params, [USER_ID, createHash("sha256").update(written.token).digest("hex"), JSON.stringify(["资料整理"])]);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO accounts")), false);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), true);
});

test("a failed code file removes the new account", async () => {
  const { pool, calls } = issuePool();
  await assert.rejects(
    issueInternalAgent(pool, "豆包", {
      envDir: "/tmp/knot-agents",
      writeEnv: async () => {
        throw new Error("disk full");
      },
    }),
    (error) => error.code === "env_failed"
  );
  assert.equal(calls.some((call) => call.sql.includes("DELETE FROM accounts")), true);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), false);
});

test("a failed code file puts a revived agent back to rest", async () => {
  const retired = { ...AGENT_ROW, retired_at: "yesterday" };
  const { pool, calls } = issuePool({ existing: retired });
  await assert.rejects(
    issueInternalAgent(pool, "豆包", {
      envDir: "/tmp/knot-agents",
      writeEnv: async () => {
        throw new Error("disk full");
      },
    }),
    (error) => error.code === "env_failed"
  );
  assert.equal(calls.some((call) => call.sql.includes("retired_at = now()")), true);
  assert.equal(calls.some((call) => call.sql.includes("DELETE FROM accounts")), false);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), false);
});

test("issuing needs an owner, an unused name, and a directory for the code", async () => {
  const closed = {
    async query() {
      throw new Error("should not look up");
    },
  };
  await assert.rejects(issueInternalAgent(closed, "  ", { envDir: "/tmp" }), (error) => error.code === "bad_name");
  await assert.rejects(issueInternalAgent(closed, "豆包", {}), (error) => error.code === "env_unconfigured");
  await assert.rejects(
    issueInternalAgent(closed, "豆包", { envDir: "/tmp", specialties: ["搜索，下载"] }),
    (error) => error.code === "bad_specialty"
  );

  const noOwner = {
    async query() {
      return { rows: [] };
    },
  };
  await assert.rejects(issueInternalAgent(noOwner, "豆包", { envDir: "/tmp" }), (error) => error.code === "owner_unconfigured");

  // 同名的人或外部 Agent 占着这个名字，不能拿来当内部 Agent。
  const taken = issuePool({ existing: { ...AGENT_ROW, role: "user", owner_id: null, retired_at: null } });
  await assert.rejects(
    issueInternalAgent(taken.pool, "豆包", { envDir: "/tmp" }),
    (error) => error.code === "name_taken"
  );
});

// 授权码的读写只走主理人名下的内部 Agent：行里有 owner_role，便于区分外部 Agent。
const OLD_TOKEN_HASH = createHash("sha256").update("tok-old").digest("hex");

function tokenPool({ ownerRole = "owner", rows = null, updateFails = false, updateMissing = false, tokenHash } = {}) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("o.role AS owner_role")) {
        const found = rows || [
          {
            id: USER_ID,
            display_name: "豆包",
            owner_id: OWNER_ID,
            owner_role: ownerRole,
            token_hash: tokenHash === undefined ? OLD_TOKEN_HASH : tokenHash,
          },
        ];
        return { rows: found, rowCount: found.length };
      }
      if (sql.includes("UPDATE accounts SET token_hash")) {
        if (updateFails) throw new Error("db down");
        if (updateMissing) return { rows: [], rowCount: 0 };
        return { rows: [{ id: USER_ID }], rowCount: 1 };
      }
      if (sql.includes("admin_actions")) return { rows: [], rowCount: 1 };
      throw new Error(`unexpected ${sql}`);
    },
  };
  return { pool, calls };
}

async function authFileDir(token, name = "豆包") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-token-"));
  const file = path.join(dir, `${name}.local.env`);
  await writeFile(
    file,
    [
      `KNOT_AGENT_NAME=${name}`,
      `KNOT_AGENT_ID=${USER_ID}`,
      `KNOT_AGENT_OWNER_ID=${OWNER_ID}`,
      `KNOT_AGENT_TOKEN=${token}`,
      "",
    ].join("\n")
  );
  return { dir, file };
}

test("the admin reads an internal agent's code back from its auth file", async () => {
  const { dir, file } = await authFileDir("tok-old");
  const readable = tokenPool();
  const found = await readManagedAgentToken(readable.pool, USER_ID, { envDir: dir });
  assert.equal(found.token, "tok-old");
  assert.equal(found.file, file);
  assert.equal(found.id, USER_ID);

  // 外部 Agent 的码归账号自己在「我的」里拿，管理端不读。
  const external = tokenPool({ ownerRole: "user" });
  await assert.rejects(
    readManagedAgentToken(external.pool, USER_ID, { envDir: dir }),
    (error) => error.code === "not_internal"
  );

  // 库里只有哈希：授权文件里没有这一行，就读不回来，只能重新签发。
  const empty = await mkdtemp(path.join(os.tmpdir(), "knot-token-empty-"));
  await assert.rejects(
    readManagedAgentToken(readable.pool, USER_ID, { envDir: empty }),
    (error) => error.code === "token_unavailable"
  );

  // 文件里的码和库里的哈希对不上：这份文件过期了，给出去也接不上。
  const stale = await authFileDir("tok-stale");
  await assert.rejects(
    readManagedAgentToken(readable.pool, USER_ID, { envDir: stale.dir }),
    (error) => error.code === "token_unavailable"
  );

  await assert.rejects(
    readManagedAgentToken(readable.pool, USER_ID, {}),
    (error) => error.code === "env_unconfigured"
  );

  // 停用的 Agent 没有令牌可给。
  await assert.rejects(
    readManagedAgentToken(tokenPool({ rows: [] }).pool, USER_ID, { envDir: dir }),
    (error) => error.code === "not_found"
  );
});

test("reissuing writes the new code back to the same auth file", async () => {
  const { dir, file } = await authFileDir("tok-old");
  const { pool, calls } = tokenPool();
  const result = await rotateManagedAgentToken(pool, USER_ID, { envDir: dir });

  assert.match(result.token, /^[A-Za-z0-9_-]+$/);
  assert.notEqual(result.token, "tok-old");
  assert.equal(result.file, file);
  const text = await readFile(file, "utf8");
  assert.equal(text.includes(`KNOT_AGENT_TOKEN=${result.token}`), true);
  assert.equal(text.includes("tok-old"), false);

  const update = calls.find((call) => call.sql.includes("UPDATE accounts SET token_hash"));
  assert.deepEqual(update.params, [USER_ID, createHash("sha256").update(result.token).digest("hex")]);
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.equal(action.params[0], USER_ID);
  assert.equal(action.params[1], "重新签发 豆包 的授权码");
});

// 早先的授权码文件里还有 KNOT_AGENT_EMAIL、KNOT_AGENT_USER_ID 这些行：
// 重签只该换令牌那一行，整份重写会把别人接的字段抹掉。
test("reissuing keeps the other lines of an older auth file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-token-legacy-"));
  const file = path.join(dir, "PaulWang-AI.local.env");
  await writeFile(
    file,
    [
      "KNOT_AGENT_NAME=PaulWang-AI",
      "KNOT_AGENT_EMAIL=writer@example.com",
      `KNOT_AGENT_USER_ID=${USER_ID}`,
      "KNOT_AGENT_TOKEN=tok-old",
      "",
    ].join("\n")
  );
  const result = await rotateManagedAgentToken(tokenPool().pool, USER_ID, { envDir: dir });
  const text = await readFile(file, "utf8");
  assert.equal(text.includes("KNOT_AGENT_EMAIL=writer@example.com"), true);
  assert.equal(text.includes(`KNOT_AGENT_USER_ID=${USER_ID}`), true);
  assert.equal(text.includes(`KNOT_AGENT_TOKEN=${result.token}`), true);
  assert.equal(text.includes("tok-old"), false);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("a failed database write puts the old code back", async () => {
  const { dir, file } = await authFileDir("tok-old");
  await assert.rejects(
    rotateManagedAgentToken(tokenPool({ updateFails: true }).pool, USER_ID, { envDir: dir }),
    (error) => error.code === "env_failed"
  );
  const text = await readFile(file, "utf8");
  assert.equal(text.includes("KNOT_AGENT_TOKEN=tok-old"), true);
});

test("a failed database write removes a code it just created", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-token-"));
  await assert.rejects(
    rotateManagedAgentToken(tokenPool({ updateFails: true }).pool, USER_ID, { envDir: dir }),
    (error) => error.code === "env_failed"
  );
  assert.deepEqual(await readdir(dir), []);
});

test("a token written just as the agent is retired is removed again", async () => {
  const { dir } = await authFileDir("tok-old");
  await assert.rejects(
    rotateManagedAgentToken(tokenPool({ updateMissing: true }).pool, USER_ID, { envDir: dir }),
    (error) => error.code === "not_found"
  );
  assert.deepEqual(await readdir(dir), []);
});

test("the admin token doors read and reissue through the auth file", async () => {
  const { dir } = await authFileDir("tok-old");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: tokenPool().pool, token: "secret", agentEnvDir: dir }));
  const server = await listen(app);
  try {
    const base = `http://127.0.0.1:${server.address().port}/api/admin`;
    const read = await fetch(`${base}/agents/${USER_ID}/token`, {
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("cache-control"), "no-store");
    assert.equal((await read.json()).token, "tok-old");

    const rotated = await fetch(`${base}/agents/${USER_ID}/token/rotate`, {
      method: "POST",
      headers: { Authorization: "Bearer secret" },
    });
    assert.equal(rotated.status, 200);
    const body = await rotated.json();
    assert.match(body.token, /^[A-Za-z0-9_-]+$/);
    assert.notEqual(body.token, "tok-old");
  } finally {
    server.close();
  }

  // 文件里读不到时给 409：页面据此提示「重新签发」。
  const empty = await mkdtemp(path.join(os.tmpdir(), "knot-token-empty-"));
  const missing = express();
  missing.use(express.json());
  missing.use("/api/admin", adminRouter({ pool: tokenPool().pool, token: "secret", agentEnvDir: empty }));
  const server2 = await listen(missing);
  try {
    const response = await fetch(
      `http://127.0.0.1:${server2.address().port}/api/admin/agents/${USER_ID}/token`,
      { headers: { Authorization: "Bearer secret" } }
    );
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), { error: "token_unavailable" });
  } finally {
    server2.close();
  }
});

test("the issue door refuses a blank name and a missing directory", async () => {
  let queried = false;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin",
    adminRouter({
      pool: {
        async query() {
          queried = true;
          return { rows: [], rowCount: 0 };
        },
      },
      token: "secret",
      agentEnvDir: "/tmp/knot-agents",
    })
  );
  const server = await listen(app);
  try {
    const port = server.address().port;
    const blank = await fetch(`http://127.0.0.1:${port}/api/admin/internal-agents`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ name: " " }),
    });
    assert.equal(blank.status, 400);
    assert.deepEqual(await blank.json(), { error: "bad_name" });
    assert.equal(queried, false);
  } finally {
    server.close();
  }

  const unconfigured = express();
  unconfigured.use(express.json());
  unconfigured.use(
    "/api/admin",
    adminRouter({
      pool: {
        async query() {
          throw new Error("should not look up");
        },
      },
      token: "secret",
    })
  );
  const server2 = await listen(unconfigured);
  try {
    const port = server2.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/internal-agents`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ name: "豆包" }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "env_unconfigured" });
  } finally {
    server2.close();
  }
});

const PLATFORM_ID = "00000000-0000-4000-8000-000000000001";
const OUTSIDE_ID = "55555555-5555-4555-8555-555555555555";
const TESTER_ID = "66666666-6666-4666-8666-666666666666";
const EXTERNAL_AGENT_ID = "77777777-7777-4777-8777-777777777777";
const RETIRED_AGENT_ID = "88888888-8888-4888-8888-888888888888";

function rosterRow(overrides) {
  return {
    side: null,
    email: null,
    owner_id: null,
    label: null,
    level: 1,
    entitlements: {},
    points_balance: 0,
    muted_until: null,
    specialties: [],
    retired_at: null,
    created_at: "2026-10-01T00:00:00.000Z",
    has_token: false,
    ...overrides,
  };
}

test("the roster lists platform, internal and external accounts with their agents", async () => {
  const rows = [
    rosterRow({ id: PLATFORM_ID, role: "platform", display_name: "Knot" }),
    rosterRow({
      id: OWNER_ID,
      role: "owner",
      side: "internal",
      email: "admin@example.com",
      display_name: "主理人",
      points_balance: 200,
    }),
    rosterRow({
      id: OUTSIDE_ID,
      role: "user",
      side: "external",
      email: "reader@example.com",
      display_name: "读者",
    }),
    rosterRow({
      id: TESTER_ID,
      role: "user",
      side: "external",
      email: "tester@example.com",
      display_name: "测试员",
      label: "tester",
    }),
    rosterRow({
      id: USER_ID,
      role: "agent",
      side: "internal",
      owner_id: OWNER_ID,
      display_name: "豆包",
      specialties: ["网页搜索"],
      has_token: true,
    }),
    rosterRow({
      id: RETIRED_AGENT_ID,
      role: "agent",
      side: "internal",
      owner_id: OWNER_ID,
      display_name: "旧助手",
      retired_at: "2026-10-02T00:00:00.000Z",
    }),
    rosterRow({
      id: EXTERNAL_AGENT_ID,
      role: "agent",
      side: "external",
      owner_id: OUTSIDE_ID,
      display_name: "读者的 Agent",
      has_token: true,
    }),
  ];
  const pool = {
    async query(sql) {
      assert.match(sql, /FROM accounts/);
      return { rows };
    },
  };
  const roster = await listAccountRoster(pool);
  // Agent 不再单独占一行：它们挂在所属账号下面。
  assert.deepEqual(
    roster.accounts.map((account) => account.role),
    ["platform", "owner", "user", "user"]
  );
  const owner = roster.accounts.find((account) => account.role === "owner");
  assert.equal(owner.agentLimit, 10);
  assert.equal(owner.agentUsed, 1);
  assert.deepEqual(
    owner.agents.map((agent) => [agent.displayName, Boolean(agent.retiredAt), agent.hasToken]),
    [
      ["豆包", false, true],
      ["旧助手", true, false],
    ]
  );
  const outside = roster.accounts.find((account) => account.id === OUTSIDE_ID);
  assert.equal(outside.agentLimit, 1);
  assert.equal(outside.agents[0].id, EXTERNAL_AGENT_ID);
  assert.deepEqual(roster.quota, {
    internalAgents: { used: 1, limit: 10 },
    // 带 label 的测试员不占外部账号名额，与库里的触发器一致。
    externalAccounts: { used: 1, limit: 90 },
    externalAgents: { used: 1 },
  });
});

test("an admin can edit the owner's name and bio", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("owner_role")) {
        return {
          rows: [
            rosterRow({
              id: OWNER_ID,
              role: "owner",
              side: "internal",
              email: "admin@example.com",
              display_name: "主理人",
              bio: "",
            }),
          ],
        };
      }
      if (sql.includes("UPDATE accounts SET")) {
        return {
          rows: [
            rosterRow({
              id: OWNER_ID,
              role: "owner",
              side: "internal",
              email: "admin@example.com",
              display_name: "PaulWang",
              bio: "白天写代码。",
            }),
          ],
        };
      }
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  const result = await updateManagedAccount(pool, OWNER_ID, { displayName: "PaulWang", bio: "白天写代码。" });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "account");
  assert.equal(result.account.displayName, "PaulWang");
  assert.equal(result.account.bio, "白天写代码。");
  const update = calls.find((call) => call.sql.includes("UPDATE accounts SET"));
  assert.match(update.sql, /display_name = \$\d+/);
  assert.match(update.sql, /bio = \$\d+/);
  const action = calls.find((call) => call.sql.includes("INSERT INTO admin_actions"));
  assert.equal(action.params[0], "config");
  assert.equal(action.params[1], OWNER_ID);
  assert.match(action.params[3], /主理人 主理人/);
});

test("an internal agent's bio, specialties and name are editable", async () => {
  const envDir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-rename-"));
  const file = path.join(envDir, "豆包.local.env");
  await writeFile(file, "KNOT_AGENT_NAME=豆包\nKNOT_AGENT_ID=" + USER_ID + "\nKNOT_AGENT_TOKEN=token-one\n", {
    mode: 0o600,
  });
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("owner_role")) {
        return {
          rows: [
            rosterRow({
              id: USER_ID,
              role: "agent",
              side: "internal",
              owner_id: OWNER_ID,
              display_name: "豆包",
              specialties: ["网页搜索"],
              bio: "",
              owner_role: "owner",
            }),
          ],
        };
      }
      if (sql.includes("UPDATE accounts SET")) {
        return {
          rows: [
            rosterRow({
              id: USER_ID,
              role: "agent",
              side: "internal",
              owner_id: OWNER_ID,
              display_name: params[0] || "豆包",
              specialties: ["网页搜索"],
              bio: "",
            }),
          ],
        };
      }
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  // 改称呼现在是允许的：库里改名，授权码文件里那一行名字跟着改，文件名与令牌都不动。
  const renamed = await updateManagedAccount(
    pool,
    USER_ID,
    { displayName: "豆包二号" },
    { envDir: envDir }
  );
  assert.equal(renamed.account.displayName, "豆包二号");
  assert.equal(renamed.envFile, file);
  assert.match(await readFile(file, "utf8"), /^KNOT_AGENT_NAME=豆包二号$/m);
  assert.match(await readFile(file, "utf8"), /^KNOT_AGENT_TOKEN=token-one$/m);
  const renameUpdate = calls.find((call) => call.sql.includes("display_name = $"));
  assert.ok(renameUpdate);

  const pool2 = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("owner_role")) {
        return {
          rows: [
            rosterRow({
              id: USER_ID,
              role: "agent",
              side: "internal",
              owner_id: OWNER_ID,
              display_name: "豆包",
              specialties: ["网页搜索"],
              bio: "",
              owner_role: "owner",
            }),
          ],
        };
      }
      if (sql.includes("UPDATE accounts SET")) {
        return {
          rows: [
            rosterRow({
              id: USER_ID,
              role: "agent",
              side: "internal",
              owner_id: OWNER_ID,
              display_name: "豆包",
              specialties: ["网页搜索", "资料整理"],
              bio: "专管网页检索。",
            }),
          ],
        };
      }
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  const result = await updateManagedAccount(pool2, USER_ID, {
    displayName: "豆包",
    bio: "专管网页检索。",
    specialties: ["网页搜索", "资料整理"],
  });
  assert.equal(result.kind, "agent");
  assert.deepEqual(result.account.specialties, ["网页搜索", "资料整理"]);
  const update = calls.filter((call) => call.sql.includes("UPDATE accounts SET")).at(-1);
  assert.match(update.sql, /specialties = \$\d+::jsonb/);
  assert.doesNotMatch(update.sql, /display_name = \$\d+/);
});

test("a rename whose auth-code file cannot be written rolls the name back", async () => {
  const calls = [];
  const envDir = await mkdtemp(path.join(os.tmpdir(), "knot-agent-rename-fail-"));
  // 目录里没有这个 Agent 的授权码文件时改名不算失败；这里把 envDir 指到一个普通文件，
  // 让 readdir 报 ENOTDIR，走到退回称呼的那条路。
  const blocked = path.join(envDir, "not-a-dir");
  await writeFile(blocked, "x");
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("owner_role")) {
        return {
          rows: [
            rosterRow({
              id: USER_ID,
              role: "agent",
              side: "internal",
              owner_id: OWNER_ID,
              display_name: "豆包",
              specialties: [],
              bio: "",
              owner_role: "owner",
            }),
          ],
        };
      }
      if (sql.includes("UPDATE accounts SET")) {
        return {
          rows: [rosterRow({ id: USER_ID, role: "agent", side: "internal", owner_id: OWNER_ID, display_name: "豆包二号" })],
        };
      }
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  await assert.rejects(
    () => updateManagedAccount(pool, USER_ID, { displayName: "豆包二号" }, { envDir: blocked }),
    (error) => error.code === "env_failed"
  );
  const rollback = calls.filter((call) => call.sql.includes("UPDATE accounts SET")).at(-1);
  assert.match(rollback.sql, /display_name = \$2/);
  assert.deepEqual(rollback.params, [USER_ID, "豆包"]);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO admin_actions")), false);
});

test("external accounts and their agents are read-only in the admin", async () => {
  for (const row of [
    rosterRow({ id: OUTSIDE_ID, role: "user", side: "external", email: "reader@example.com", display_name: "读者" }),
    rosterRow({
      id: EXTERNAL_AGENT_ID,
      role: "agent",
      side: "external",
      owner_id: OUTSIDE_ID,
      display_name: "读者的 Agent",
      owner_role: "user",
    }),
    rosterRow({ id: PLATFORM_ID, role: "platform", display_name: "Knot" }),
  ]) {
    const pool = {
      async query(sql) {
        if (sql.includes("owner_role")) return { rows: [row] };
        throw new Error(`unexpected ${sql}`);
      },
    };
    await assert.rejects(
      () => updateManagedAccount(pool, row.id, { bio: "改一改" }),
      (error) => error.code === "not_editable"
    );
  }
});

test("a profile edit with nothing to change is refused instead of writing an empty action", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("owner_role")) {
        return {
          rows: [rosterRow({ id: OWNER_ID, role: "owner", side: "internal", display_name: "主理人", bio: "原样" })],
        };
      }
      throw new Error(`unexpected ${sql}`);
    },
  };
  await assert.rejects(
    () => updateManagedAccount(pool, OWNER_ID, { displayName: "主理人", bio: "原样" }),
    (error) => error.code === "empty_body"
  );
  await assert.rejects(
    () => updateManagedAccount(pool, OWNER_ID, {}),
    (error) => error.code === "empty_body"
  );
});

test("an admin can stop an external account's agent too", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("owner_role")) {
        return { rows: [{ id: EXTERNAL_AGENT_ID, display_name: "读者的 Agent", owner_role: "user" }] };
      }
      if (sql.includes("retired_at = now()")) {
        return { rows: [{ id: EXTERNAL_AGENT_ID, owner_id: OUTSIDE_ID, display_name: "读者的 Agent" }] };
      }
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [] };
      throw new Error(`unexpected ${sql}`);
    },
  };
  const result = await retireManagedAgent(pool, EXTERNAL_AGENT_ID, "令牌泄漏。");
  assert.equal(result.ok, true);
  assert.equal(result.ownerRole, "user");
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.equal(action.params[0], "retire");
  assert.equal(action.params[1], EXTERNAL_AGENT_ID);
  assert.match(action.params[3], /外部 Agent 读者的 Agent/);
});

// 实例前面有一层本机反代（入口隧道）时，remoteAddress 恒为回环；管理门要读代理
// 写下的真实客户端地址，否则「只给内网」这一条等于没开（S12-07）。
test("the admin door reads the client behind the local proxy, not the proxy itself", () => {
  assert.equal(adminDoorAddress({ socket: { remoteAddress: "192.168.3.20" }, ip: "192.168.3.20" }), "192.168.3.20");
  assert.equal(adminDoorAddress({ socket: { remoteAddress: "127.0.0.1" }, ip: "203.0.113.9" }), "203.0.113.9");
  assert.equal(adminDoorAddress({ socket: { remoteAddress: "::1" }, ip: "::ffff:203.0.113.9" }), "::ffff:203.0.113.9");
  // 内网直连时伪造 X-Forwarded-For 也没用：对端不是回环就不看 req.ip。
  assert.equal(adminDoorAddress({ socket: { remoteAddress: "192.168.3.20" }, ip: "127.0.0.1" }), "192.168.3.20");
  // 取不到对端时按拒绝处理，不回落到可伪造的 req.ip。
  assert.equal(adminDoorAddress({ ip: "127.0.0.1" }), "");
});

// 路由接线也要有用例：函数层通过不等于端点接对了（S13-03）。
test("the mute door records the deadline and the audit row", async () => {
  const { pool, calls } = accountPool(PERSON, (sql) => {
    if (sql.includes("FOR UPDATE")) return { rows: [PERSON] };
    if (sql.includes("UPDATE accounts")) return { rows: [{ ...PERSON, muted_until: new Date(Date.now() + 3_600_000) }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool, token: "secret" }));
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/mute`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ user: "a@example.com", until: "1h", body: "请停止骚扰。" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.muted, true);
    const action = calls.find((call) => call.sql.includes("INSERT INTO admin_actions"));
    assert.match(action.sql, /'mute'/);
    assert.equal(action.params[0], USER_ID);
  } finally {
    server.close();
  }
});

test("the remove door passes the reason through and writes one audit row", async () => {
  const rows = [{ id: POST_ID, account_id: USER_ID }];
  const client = {
    async query(sql) {
      if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
      if (sql.includes("UPDATE intel")) return { rows };
      return { rows: [] };
    },
    release() {},
  };
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [] };
    },
    async connect() {
      return client;
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool, token: "secret" }));
  const server = await listen(app);
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admin/posts/${POST_ID}/remove`, {
      method: "POST",
      headers: { Authorization: "Bearer secret", "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "重复发布" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, already: false, id: POST_ID, userId: USER_ID });
  } finally {
    server.close();
  }
});
