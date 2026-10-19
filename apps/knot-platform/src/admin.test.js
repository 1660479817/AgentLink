import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import express from "express";
import {
  bearerToken,
  clipText,
  hoursWithin,
  isLoopbackAddress,
  grantPoints,
  issueInternalAgent,
  listPosts,
  muteUser,
  removePost,
  setEntitlements,
  setLevel,
  tokensMatch,
  unmuteUser,
  warnUser,
} from "./admin.js";
import { assertCanSpeak, muteState } from "./account.js";
import { adminRouter } from "./routes/admin.js";
import { installSystemPolicy, resetSystemPolicy } from "./system.js";

const POST_ID = "23737bf5-537f-441f-bc86-bf230d1cf9ed";
const USER_ID = "11111111-1111-4111-8111-111111111111";

test("loopback is the machine itself", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.3.91"), false);
  assert.equal(bearerToken("Bearer secret"), "secret");
  assert.equal(tokensMatch("secret", "secret"), true);
  assert.equal(tokensMatch("secret", "other"), false);
  assert.equal(tokensMatch("", ""), false);
  assert.equal(clipText("  a   b  ", 10), "a b");
});

test("remove records the reason and tells the author", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE intel")) return { rows: [{ id: params[0], user_id: USER_ID }] };
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
      return { rows: [] };
    },
  };
  const result = await removePost(pool, POST_ID, "含有欺诈内容。");
  assert.equal(result.already, false);
  assert.equal(result.userId, USER_ID);
  assert.match(calls[0].sql, /verdict = 'removed'/);
  assert.equal(calls[0].params[1], "含有欺诈内容。");
  assert.equal(calls[1].params[1], "intel_removed");
  assert.equal(calls[1].params[2], "帖子已删除");
  assert.match(calls[2].sql, /admin_actions/);
  assert.equal(calls[2].params[0], "remove");
});

test("a web close records which human admin did it", async () => {
  const ADMIN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("UPDATE intel")) return { rows: [{ id: params[0], user_id: USER_ID }] };
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
      return { rows: [] };
    },
  };
  await removePost(pool, POST_ID, "平台关闭", ADMIN_ID);
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.match(action.sql, /actor_id/);
  assert.equal(action.params[0], "remove");
  assert.equal(action.params[1], USER_ID);
  assert.equal(action.params[4], ADMIN_ID);
});

test("a second remove of the same post stays quiet", async () => {
  let updates = 0;
  const pool = {
    async query(sql) {
      if (sql.includes("UPDATE intel")) {
        updates += 1;
        return { rows: [] };
      }
      if (sql.includes("verdict = 'removed'")) return { rows: [{ id: POST_ID }] };
      return { rows: [] };
    },
  };
  const result = await removePost(pool, POST_ID, "含有欺诈内容。");
  assert.equal(result.already, true);
  assert.equal(updates, 1);
});

test("grant adds the amount once and tells the person", async () => {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO admin_actions")) return { rows: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] };
      if (sql.includes("UPDATE users")) return { rows: [{ points_balance: 150 }] };
      if (sql.includes("INSERT INTO notifications")) return { rows: [{ id: "n1" }] };
      return { rows: [] };
    },
    release() {},
  };
  const pool = {
    async query(sql) {
      if (sql.includes("FROM users")) {
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

test("a grant needs one account, a positive amount, and a reason", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM users")) {
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
        if (sql.includes("FROM users")) return { rows: [user] };
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
    if (sql.includes("UPDATE users")) return { rows: [{ ...PERSON, muted_until: params[1] }] };
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
    if (sql.includes("UPDATE users")) return { rows: [{ ...PERSON, muted_until: params[1] }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const week = await muteUser(timed.pool, "a@example.com", "7d", "请停止骚扰。");
  assert.equal(week.user.muted, true);
  assert.ok(week.user.mutedUntil);

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
          return { rows: [{ ...PERSON, label: "platform" }] };
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
    if (sql.includes("UPDATE users")) return { rows: [{ ...PERSON, muted_until: null }] };
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
    if (sql.includes("UPDATE users")) return { rows: [{ ...held, entitlements: { honors: ["早期用户", "审稿"] } }] };
    if (sql.includes("notifications")) return { rows: [{ id: "n1" }] };
    return { rows: [] };
  });
  const result = await setEntitlements(pool, "a@example.com", ["审稿", "早期用户"], [], "感谢长期供稿。");
  assert.deepEqual(result.granted, ["审稿"]);
  assert.deepEqual(result.revoked, []);
  assert.deepEqual(result.user.entitlements, ["早期用户", "审稿"]);
  const saved = calls.find((call) => call.sql.includes("UPDATE users"));
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
    if (sql.includes("UPDATE users")) return { rows: [{ ...PERSON, level: 3 }] };
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
          return { rows: [{ ...PERSON, label: "platform" }] };
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
    assertCanSpeak(
      {
        async query() {
          return { rows: [{ muted_until: new Date(Date.now() + 60_000) }] };
        },
      },
      USER_ID
    ),
    (error) => error.code === "muted"
  );
  await assertCanSpeak(
    {
      async query() {
        return { rows: [{ muted_until: new Date(Date.now() - 60_000) }] };
      },
    },
    USER_ID
  );
});

test("a warning needs one account", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("FROM users")) {
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
      if (sql.includes("FROM users")) {
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
      if (sql.includes("FROM users")) {
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
    assert.deepEqual(await ok.json(), { posts: [] });
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
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("INSERT INTO system_policy")) return { rows: [{ updated_at: new Date("2026-10-19T00:00:00Z") }] };
      return { rows: [] };
    },
  };
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
    assert.equal(audit.params[0], "站内浏览、公开快照");

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
  const pool = {
    async query(sql, params) {
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
    },
  };
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
        query: async () => ({
          rows: [{ total: "205", platform: "5" }],
        }),
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
      attention: { reads: 0, searches: 0 },
    });
  } finally {
    server.close();
  }
});

const ISSUED_USER = {
  id: USER_ID,
  email: "manwjh@gmail.com",
  display_name: "豆包",
  label: "",
  side: "internal",
  level: 1,
  entitlements: {},
  points_balance: 100,
  muted_until: null,
  specialties: ["网页搜索", "资料整理"],
};

function issuePool({ existing = false, delegation = false, copies = 1 } = {}) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("lower(btrim(display_name))")) {
        if (!existing) return { rows: [], rowCount: 0 };
        const row = { id: USER_ID, points_balance: 80, side: "internal" };
        return { rows: Array.from({ length: copies }, () => row), rowCount: copies };
      }
      if (sql.includes("INSERT INTO users")) return { rows: [{ id: USER_ID, points_balance: 100 }], rowCount: 1 };
      if (sql.includes("FROM delegations")) {
        return delegation ? { rows: [{ ok: 1 }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO delegations") || sql.includes("UPDATE users SET specialties") || sql.includes("DELETE FROM") || sql.includes("admin_actions")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("specialties FROM users")) return { rows: [ISSUED_USER], rowCount: 1 };
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
  const delegation = calls.find((call) => call.sql.includes("INSERT INTO delegations"));
  assert.deepEqual(delegation.params, [USER_ID, digest]);
  const specialties = calls.find((call) => call.sql.includes("UPDATE users SET specialties"));
  assert.equal(specialties.params[1], JSON.stringify(["网页搜索", "资料整理"]));
  const action = calls.find((call) => call.sql.includes("admin_actions"));
  assert.equal(action.params[0], USER_ID);
  assert.equal(action.params[1], "签发 豆包。特长 网页搜索、资料整理");
  assert.equal(result.created, true);
  assert.equal(result.issued, true);
  assert.equal(result.already, false);
  assert.equal(result.envFile, "/tmp/knot-agents/豆包.local.env");
  assert.deepEqual(result.user.specialties, ["网页搜索", "资料整理"]);
  assert.equal(JSON.stringify(result).includes(written.issued.token), false);
  assert.equal(action.params[1].includes(written.issued.token), false);
});

test("an existing internal agent keeps its code and specialties", async () => {
  const { pool, calls } = issuePool({ existing: true, delegation: true });
  let written = false;
  const result = await issueInternalAgent(pool, "豆包", {
    envDir: "/tmp/knot-agents",
    specialties: ["网页搜索"],
    writeEnv: async () => {
      written = true;
      return "/tmp/should-not";
    },
  });
  assert.equal(written, false);
  assert.equal(result.created, false);
  assert.equal(result.issued, false);
  assert.equal(result.already, true);
  assert.equal(result.envFile, null);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), false);
  assert.equal(calls.some((call) => call.sql.includes("UPDATE users")), false);
});

test("a missing code is written again without creating a second account", async () => {
  const { pool, calls } = issuePool({ existing: true, delegation: false });
  const result = await issueInternalAgent(pool, "豆包", {
    envDir: "/tmp/knot-agents",
    writeEnv: async () => "/tmp/knot-agents/豆包.local.env",
  });
  assert.equal(result.created, false);
  assert.equal(result.issued, true);
  assert.equal(calls.some((call) => call.sql.includes("INSERT INTO users")), false);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), true);
  assert.equal(calls.find((call) => call.sql.includes("admin_actions")).params[1], "签发 豆包");
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
  assert.equal(calls.some((call) => call.sql.includes("DELETE FROM delegations")), true);
  assert.equal(calls.some((call) => call.sql.includes("DELETE FROM users")), true);
  assert.equal(calls.some((call) => call.sql.includes("admin_actions")), false);
});

test("issuing needs one unused name and a directory for the code", async () => {
  const closed = {
    async query() {
      throw new Error("should not look up");
    },
  };
  await assert.rejects(issueInternalAgent(closed, "豆 包", { envDir: "/tmp" }), (error) => error.code === "bad_name");
  await assert.rejects(issueInternalAgent(closed, "豆包", {}), (error) => error.code === "env_unconfigured");
  await assert.rejects(
    issueInternalAgent(closed, "豆包", { envDir: "/tmp", specialties: ["搜索，下载"] }),
    (error) => error.code === "bad_specialty"
  );
  const { pool } = issuePool({ existing: true, copies: 2 });
  await assert.rejects(issueInternalAgent(pool, "豆包", { envDir: "/tmp" }), (error) => error.code === "ambiguous");
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
