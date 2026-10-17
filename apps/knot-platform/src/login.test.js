import assert from "node:assert/strict";
import test from "node:test";
import { adminEmail, defaultDisplayName, feedbackMessage, isAdminUser, loginKeyMessage, newLoginKey, normalizeLoginKey, redeemLoginKey } from "./login.js";

test("login key is six digits", () => {
  for (let i = 0; i < 30; i += 1) {
    const key = newLoginKey();
    assert.match(key, /^\d{6}$/);
    assert.equal(normalizeLoginKey(key), key);
  }
  assert.equal(normalizeLoginKey(" 048 291 "), "048291");
  assert.equal(normalizeLoginKey("4829131"), null);
  assert.equal(normalizeLoginKey("AB23CD45"), null);
});

test("a default display name is the email prefix, never empty", () => {
  assert.equal(defaultDisplayName("paul.wang@example.com"), "paul.wang");
  assert.equal(defaultDisplayName("PAUL@example.com"), "PAUL");
  assert.equal(defaultDisplayName(""), "用户");
  assert.equal(defaultDisplayName("a".repeat(60) + "@example.com"), "a".repeat(40));
});

test("admin mailbox defaults to the platform address", () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  delete process.env.KNOT_ADMIN_EMAIL;
  try {
    assert.equal(adminEmail(), "manwjh@gmail.com");
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
});

test("an admin is the account whose email matches the admin mailbox", async () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  delete process.env.KNOT_ADMIN_EMAIL;
  try {
    const pool = {
      async query(sql, params) {
        assert.match(sql, /SELECT email FROM users/);
        return { rows: params[0] === "admin" ? [{ email: "manwjh@gmail.com" }] : [{ email: "someone@example.com" }] };
      },
    };
    assert.equal(await isAdminUser(pool, "admin"), true);
    assert.equal(await isAdminUser(pool, "other"), false);
    assert.equal(await isAdminUser(pool, null), false);
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
});

test("the login key email carries the key as HTML and plain text", () => {
  const message = loginKeyMessage("048291");
  assert.equal(message.subject, "Knot 登录密钥");
  assert.match(message.text, /048291/);
  assert.match(message.text, /十分钟内有效/);
  assert.match(message.html, /登录和注册都用这一把密钥/);
  for (const digit of "048291") {
    assert.match(message.html, new RegExp(`>${digit}</div>`));
  }
});

test("a complaint letter names the account and keeps the text", () => {
  const message = feedbackMessage({
    kind: "complaint",
    accountEmail: "name@example.com",
    userId: "user-1",
    body: "页面打不开",
  });
  assert.equal(message.subject, "Knot 投诉");
  assert.match(message.text, /类型：投诉/);
  assert.match(message.text, /账户：name@example.com/);
  assert.match(message.text, /用户：user-1/);
  assert.match(message.text, /页面打不开/);
});

function redeemPool(insertUser) {
  const inserts = [];
  const pool = {
    async query(sql, params) {
      if (sql.includes("UPDATE login_keys")) return { rowCount: 1, rows: [{ id: "key-1" }] };
      if (sql.includes("INSERT INTO users")) {
        inserts.push(params);
        return insertUser(inserts.length, params);
      }
      throw new Error(sql);
    },
  };
  return { pool, inserts };
}

test("a new account takes the email prefix as its display name", async () => {
  const { pool, inserts } = redeemPool(() => ({ rows: [{ id: "user-1", points_balance: 100 }] }));
  const redeemed = await redeemLoginKey(pool, "paul.wang@example.com", "048291");
  assert.deepEqual(redeemed, { userId: "user-1", pointsBalance: 100 });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "paul.wang");
});

test("a taken display name gets a number and the insert is tried again", async () => {
  const { pool, inserts } = redeemPool((attempt) => {
    if (attempt > 1) return { rows: [{ id: "user-2", points_balance: 100 }] };
    const error = new Error("duplicate key");
    error.code = "23505";
    error.constraint = "users_display_name_key";
    throw error;
  });
  const redeemed = await redeemLoginKey(pool, "paul@example.com", "048291");
  assert.equal(redeemed.userId, "user-2");
  assert.deepEqual(inserts.map((params) => params[1]), ["paul", "paul 1"]);
});

test("a unique clash that is not the display name is not retried", async () => {
  const { pool, inserts } = redeemPool(() => {
    const error = new Error("duplicate key");
    error.code = "23505";
    error.constraint = "users_email_external_key";
    throw error;
  });
  await assert.rejects(() => redeemLoginKey(pool, "paul@example.com", "048291"), /duplicate key/);
  assert.equal(inserts.length, 1);
});

test("a wrong key never writes an account", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("UPDATE login_keys")) return { rowCount: 0, rows: [] };
      throw new Error("should not insert");
    },
  };
  assert.deepEqual(await redeemLoginKey(pool, "paul@example.com", "000000"), { error: "bad_key", status: 400 });
});
