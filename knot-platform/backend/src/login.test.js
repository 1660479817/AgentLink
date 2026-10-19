import assert from "node:assert/strict";
import test from "node:test";
import { adminEmail, defaultDisplayName, feedbackMessage, isAdminUser, loginKeyMessage, newLoginKey, normalizeLoginKey, redeemLoginKey, requestLoginKey } from "./login.js";
import { installSystemPolicy, resetSystemPolicy } from "./system.js";

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

test("the admin mailbox comes from config and is empty when unset", () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  delete process.env.KNOT_ADMIN_EMAIL;
  try {
    assert.equal(adminEmail(), null);
    process.env.KNOT_ADMIN_EMAIL = "Admin@Example.com";
    assert.equal(adminEmail(), "admin@example.com");
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
});

test("an admin is the account whose email matches the admin mailbox", async () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  process.env.KNOT_ADMIN_EMAIL = "manwjh@gmail.com";
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

const TX = /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/;

function poolWith(handler) {
  const query = async (sql, params) => {
    if (TX.test(sql)) return { rowCount: 0, rows: [] };
    return handler(sql, params);
  };
  return { query, connect: async () => ({ query, release() {} }) };
}

function redeemPool(insertUser) {
  const inserts = [];
  const pool = poolWith((sql, params) => {
    if (sql.includes("UPDATE login_keys")) return { rowCount: 1, rows: [{ id: "key-1" }] };
    if (sql.includes("INSERT INTO users")) {
      inserts.push(params);
      return insertUser(inserts.length, params);
    }
    throw new Error(sql);
  });
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
  const pool = poolWith((sql) => {
    if (sql.includes("UPDATE login_keys")) return { rowCount: 0, rows: [] };
    throw new Error("should not insert");
  });
  assert.deepEqual(await redeemLoginKey(pool, "paul@example.com", "000000"), { error: "bad_key", status: 400 });
});

function gatedPool({ inserted = true, inviteId = null, consume = true } = {}) {
  return poolWith((sql) => {
    if (sql.includes("UPDATE login_keys")) return { rowCount: 1, rows: [{ id: "key-1", invite_code_id: inviteId }] };
    if (sql.includes("INSERT INTO users")) return { rows: [{ id: "user-1", points_balance: 100, inserted }] };
    if (sql.includes("UPDATE invite_codes")) return { rowCount: consume ? 1 : 0, rows: consume ? [{ id: inviteId }] : [] };
    if (sql.includes("INSERT INTO invite_redemptions")) return { rowCount: 1, rows: [] };
    throw new Error(sql);
  });
}

test("邀请制下新账户必须带着能用的码", async () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "invite", publicBoard: false });
  try {
    assert.deepEqual(await redeemLoginKey(gatedPool({ inviteId: null }), "new@example.com", "048291"), {
      error: "invite_required",
      status: 400,
    });
    assert.deepEqual(await redeemLoginKey(gatedPool({ inviteId: "inv-1", consume: false }), "new@example.com", "048291"), {
      error: "bad_invite",
      status: 400,
    });
    assert.deepEqual(await redeemLoginKey(gatedPool({ inviteId: "inv-1" }), "new@example.com", "048291"), {
      userId: "user-1",
      pointsBalance: 100,
    });
  } finally {
    resetSystemPolicy();
  }
});

test("暂停注册只挡新账户，老账户照常登录", async () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "closed", publicBoard: false });
  try {
    assert.deepEqual(await redeemLoginKey(gatedPool(), "new@example.com", "048291"), {
      error: "registration_closed",
      status: 403,
    });
    assert.deepEqual(await redeemLoginKey(gatedPool({ inserted: false }), "old@example.com", "048291"), {
      userId: "user-1",
      pointsBalance: 100,
    });
  } finally {
    resetSystemPolicy();
  }
});

function requestPool({ existing = false, invite = false } = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM login_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM users")) return { rows: existing ? [{ exists: 1 }] : [] };
      if (sql.includes("FROM invite_codes")) return { rows: invite ? [{ id: "inv-1" }] : [] };
      if (sql.includes("INSERT INTO login_keys")) throw new Error("passed_gate");
      throw new Error(sql);
    },
  };
}

test("暂停注册时不给新邮箱发密钥", async () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "closed", publicBoard: false });
  try {
    assert.deepEqual(await requestLoginKey(requestPool(), "new@example.com"), {
      error: "registration_closed",
      status: 403,
    });
  } finally {
    resetSystemPolicy();
  }
});

test("邀请制先验码再发密钥，已有账户不看码", async () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "invite", publicBoard: false });
  try {
    assert.deepEqual(await requestLoginKey(requestPool(), "new@example.com"), { error: "invite_required", status: 400 });
    assert.deepEqual(await requestLoginKey(requestPool(), "new@example.com", { inviteCode: "NOPE" }), {
      error: "bad_invite",
      status: 400,
    });
    await assert.rejects(() => requestLoginKey(requestPool({ existing: true }), "old@example.com"), /passed_gate/);
  } finally {
    resetSystemPolicy();
  }
});
