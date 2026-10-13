import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  bearerToken,
  clipText,
  hoursWithin,
  isLoopbackAddress,
  listPosts,
  removePost,
  tokensMatch,
  warnUser,
} from "./admin.js";
import { adminRouter } from "./routes/admin.js";

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
  } finally {
    server2.close();
  }
});
