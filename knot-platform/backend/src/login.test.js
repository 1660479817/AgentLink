import assert from "node:assert/strict";
import test from "node:test";
import { adminEmail, defaultDisplayName, ensureOwner, feedbackMessage, isOwnerAccount, loginKeyMessage, loginLockRemaining, LOGIN_LOCK_MS, LOGIN_MAX_FAILURES, newLoginKey, normalizeLoginKey, redeemLoginKey, relayUrl, requestLoginKey, resetLoginGuard, sendLoginKey } from "./login.js";
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

test("an admin is the account whose role is owner, not an email match", async () => {
  const pool = {
    async query(sql, params) {
      assert.match(sql, /SELECT role FROM accounts/);
      return { rows: [{ role: params[0] === "admin" ? "owner" : "user" }] };
    },
  };
  assert.equal(await isOwnerAccount(pool, "admin"), true);
  assert.equal(await isOwnerAccount(pool, "other"), false);
  assert.equal(await isOwnerAccount(pool, null), false);
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

// 收件人可能在不同实例上各有账号，主题和正文都必须写明是哪个站。
test("登录密钥信写明站点名与地址", () => {
  const site = { name: "zhoujj", url: "https://zhoujj.xknot.si", locale: "zh-CN" };
  const message = loginKeyMessage("048291", site);
  assert.equal(message.subject, "zhoujj 登录密钥");
  assert.match(message.text, /站点：zhoujj {2}https:\/\/zhoujj\.xknot\.si/);
  assert.match(message.html, />zhoujj<\/span>/);
  assert.match(message.html, /站点：zhoujj/);
});

test("本机地址不写进信里：收件人点不开", () => {
  for (const origin of ["http://127.0.0.1:8080", "http://localhost:8080", "http://knot:8080"]) {
    const message = loginKeyMessage("048291", { name: "本机", url: origin });
    assert.doesNotMatch(message.text, /127\.0\.0\.1|localhost|knot:8080/);
    assert.match(message.text, /站点：本机/);
  }
});

test("站点名进 HTML 前要转义", () => {
  const message = loginKeyMessage("048291", { name: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(message.html, /<img src=x/);
  assert.match(message.html, /&lt;img src=x/);
});

test("登录密钥信跟着站点语种走", () => {
  const en = loginKeyMessage("048291", { name: "Studio", url: "https://studio.xknot.si", locale: "en" });
  assert.equal(en.subject, "Your Studio sign-in key");
  assert.match(en.text, /Valid for ten minutes/);
  assert.match(en.text, /Site: Studio/);
  assert.equal(/你好/.test(en.html), false);

  const tw = loginKeyMessage("048291", { name: "工作室", locale: "zh-TW" });
  assert.equal(tw.subject, "工作室 登入金鑰");
  assert.match(tw.text, /十分鐘內有效/);

  // 档案里写错的语种当作没写，回落到站点默认。
  const fallback = loginKeyMessage("048291", { name: "站点", locale: "ja" });
  assert.equal(fallback.subject, "站点 登录密钥");
});

test("联邦代发时正文加一行代发声明，否则不加", () => {
  const site = { name: "zhoujj", url: "https://zhoujj.xknot.si" };
  const relayed = loginKeyMessage("048291", site, { relayed: true });
  assert.match(relayed.text, /本邮件由 XKnot 联邦代 zhoujj 发出。/);
  assert.match(relayed.html, /本邮件由 XKnot 联邦代 zhoujj 发出。/);
  const direct = loginKeyMessage("048291", site);
  assert.doesNotMatch(direct.text, /联邦代/);
  assert.doesNotMatch(direct.html, /联邦代/);
});

test("委托发信：配了凭据就走联邦，不碰 SMTP", async () => {
  const previous = {
    url: process.env.XKNOT_HUB_RELAY_URL,
    token: process.env.XKNOT_HUB_RELAY_TOKEN,
    host: process.env.SMTP_HOST,
  };
  process.env.XKNOT_HUB_RELAY_URL = "https://xknot.test/api/federation/mail";
  process.env.XKNOT_HUB_RELAY_TOKEN = "xkr_wang_test";
  process.env.SMTP_HOST = "smtp.example.com";

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await sendLoginKey("lin@example.com", "048291", { name: "zhoujj", url: "https://zhoujj.xknot.si" });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["XKNOT_HUB_RELAY_URL", previous.url],
      ["XKNOT_HUB_RELAY_TOKEN", previous.token],
      ["SMTP_HOST", previous.host],
    ]) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://xknot.test/api/federation/mail");
  assert.equal(calls[0].init.headers.authorization, "Bearer xkr_wang_test");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, "lin@example.com");
  assert.equal(body.subject, "zhoujj 登录密钥");
  assert.match(body.text, /048291/);
  assert.match(body.text, /站点：zhoujj {2}https:\/\/zhoujj\.xknot\.si/);
  // 代发只收纯文本：HTML 不出实例，所以正文必须自带代发声明。
  assert.match(body.text, /本邮件由 XKnot 联邦代 zhoujj 发出。/);
  assert.equal(body.html, undefined);
});

test("委托发信：只给中枢地址和凭据时，发信地址按契约推导", async () => {
  const previous = {
    url: process.env.XKNOT_HUB_RELAY_URL,
    origin: process.env.XKNOT_HUB_ORIGIN,
    token: process.env.XKNOT_HUB_RELAY_TOKEN,
    host: process.env.SMTP_HOST,
  };
  delete process.env.XKNOT_HUB_RELAY_URL;
  process.env.XKNOT_HUB_ORIGIN = "https://xknot.test/";
  process.env.XKNOT_HUB_RELAY_TOKEN = "xkr_wang_test";
  process.env.SMTP_HOST = "smtp.example.com";

  assert.equal(relayUrl(), "https://xknot.test/api/federation/mail");

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await sendLoginKey("lin@example.com", "048291");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of [
      ["XKNOT_HUB_RELAY_URL", previous.url],
      ["XKNOT_HUB_ORIGIN", previous.origin],
      ["XKNOT_HUB_RELAY_TOKEN", previous.token],
      ["SMTP_HOST", previous.host],
    ]) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://xknot.test/api/federation/mail");
});

test("显式写了发信地址时以它为准", () => {
  assert.equal(
    relayUrl({ XKNOT_HUB_ORIGIN: "https://xknot.test", XKNOT_HUB_RELAY_URL: "http://127.0.0.1:5181/api/federation/mail" }),
    "http://127.0.0.1:5181/api/federation/mail"
  );
  assert.equal(relayUrl({}), "");
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
    // 主理人由启动时的 ensureOwner 建好；发密钥这条路上只看它是否存在。
    if (sql.includes("role = 'owner'")) return { rows: [] };
    if (sql.includes("INSERT INTO accounts")) {
      inserts.push(params);
      return insertUser(inserts.length, params);
    }
    throw new Error(sql);
  });
  return { pool, inserts };
}

test("a new account takes the email prefix as its display name", async () => {
  const { pool, inserts } = redeemPool(() => ({ rows: [{ id: "user-1", points_balance: 100, role: "user" }] }));
  const redeemed = await redeemLoginKey(pool, "paul.wang@example.com", "048291");
  assert.deepEqual(redeemed, { userId: "user-1", pointsBalance: 100, role: "user" });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "paul.wang");
});

test("a taken display name gets a number and the insert is tried again", async () => {
  const { pool, inserts } = redeemPool((attempt) => {
    if (attempt > 1) return { rows: [{ id: "user-2", points_balance: 100, role: "user" }] };
    const error = new Error("duplicate key");
    error.code = "23505";
    error.constraint = "accounts_display_name_key";
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
    error.constraint = "accounts_email_key";
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
    if (sql.includes("role = 'owner'")) return { rows: [] };
    if (sql.includes("INSERT INTO accounts")) return { rows: [{ id: "user-1", points_balance: 100, role: "user", inserted }] };
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
      role: "user",
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
      role: "user",
    });
  } finally {
    resetSystemPolicy();
  }
});

function requestPool({ existing = false, invite = false } = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM login_keys")) return { rowCount: 0, rows: [] };
      if (sql.includes("FROM accounts")) return { rows: existing ? [{ exists: 1 }] : [] };
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

function ownerPool(handler) {
  const calls = [];
  const query = async (sql, params) => {
    calls.push({ sql, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
    return handler(sql, params);
  };
  const client = { query, release() {} };
  return { calls, query, connect: async () => client };
}

async function withAdminEmail(email, run) {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  if (email == null) delete process.env.KNOT_ADMIN_EMAIL;
  else process.env.KNOT_ADMIN_EMAIL = email;
  try {
    return await run();
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
}

test("没有配置管理员邮箱就不建主理人", async () => {
  await withAdminEmail(null, async () => {
    const pool = ownerPool(() => {
      throw new Error("no query expected");
    });
    assert.equal(await ensureOwner(pool), null);
    assert.equal(pool.calls.length, 0);
  });
});

test("启动时把唯一的主理人绑到配置的邮箱", async () => {
  await withAdminEmail("Boss@Example.com", async () => {
    // 库里还没有主理人：用配置的邮箱新建一个。
    const created = ownerPool((sql, params) => {
      if (sql.includes("WHERE role = 'owner'")) return { rows: [] };
      if (sql.includes("lower(email) = lower($1)")) return { rows: [] };
      if (sql.includes("INSERT INTO accounts")) return { rows: [{ id: "owner-new" }] };
      throw new Error(sql);
    });
    assert.equal(await ensureOwner(created), "owner-new");
    const insert = created.calls.find((call) => call.sql.includes("INSERT INTO accounts"));
    assert.deepEqual(insert.params, ["boss@example.com", "boss"]);

    // 已有主理人、邮箱变了：改绑到新邮箱，不新建第二个人。
    let seen = false;
    const rebound = ownerPool((sql) => {
      if (sql.includes("WHERE role = 'owner'")) {
        if (seen) return { rows: [] };
        seen = true;
        return { rows: [{ id: "owner-1" }] };
      }
      if (sql.includes("UPDATE accounts SET email")) return { rows: [], rowCount: 1 };
      throw new Error(sql);
    });
    assert.equal(await ensureOwner(rebound), "owner-1");
    const update = rebound.calls.find((call) => call.sql.includes("UPDATE accounts SET email"));
    assert.deepEqual(update.params, ["owner-1", "boss@example.com"]);
  });
});

test("旧邮箱注册过的账号被收回成主理人，名下 Agent 一并转内部", async () => {
  await withAdminEmail("boss@example.com", async () => {
    const pool = ownerPool((sql, params) => {
      if (sql.includes("WHERE role = 'owner'")) return { rows: [] };
      if (sql.includes("lower(email) = lower($1)")) return { rows: [{ id: "user-1" }] };
      if (sql.includes("SET side = 'internal'")) return { rows: [], rowCount: 1, params };
      throw new Error(sql);
    });
    assert.equal(await ensureOwner(pool), "user-1");
    const promote = pool.calls.find((call) => call.sql.includes("SET role = 'owner'"));
    assert.match(promote.sql, /role = 'user'/);
    const side = pool.calls.find((call) => call.sql.includes("SET side = 'internal'"));
    assert.deepEqual(side.params, ["user-1"]);
    assert.ok(pool.calls.some((call) => call.sql.trim() === "COMMIT"));
  });
});

test("另一个进程刚好建好主理人时，以它为准", async () => {
  await withAdminEmail("boss@example.com", async () => {
    let ownerLookups = 0;
    const pool = ownerPool((sql) => {
      if (sql.includes("WHERE role = 'owner'")) {
        ownerLookups += 1;
        // 第一次查不到，抢建时撞上唯一索引，第二次查到对方建好的那行。
        return ownerLookups === 1 ? { rows: [] } : { rows: [{ id: "owner-other" }] };
      }
      if (sql.includes("lower(email) = lower($1)")) {
        throw Object.assign(new Error("duplicate"), { code: "23505", constraint: "accounts_one_owner" });
      }
      if (sql.includes("SET side = 'internal'")) return { rows: [], rowCount: 0 };
      throw new Error(sql);
    });
    assert.equal(await ensureOwner(pool), "owner-other");
  });
});

// 登录码是 6 位、10 分钟有效，一共 10^6 个取值。不设次数上限时，
// 知道邮箱的人可以把空格基本走完——所以这里测的是「试错会被计数并被锁住」。

function badKeyPool() {
  return {
    pool: poolWith((sql) => {
      if (sql.includes("UPDATE login_keys")) return { rowCount: 0, rows: [] };
      throw new Error(sql);
    }),
  };
}

test("wrong keys lock the mailbox before the code space can be walked", async () => {
  resetLoginGuard();
  try {
    const email = "guess@example.com";
    const { pool } = badKeyPool();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) {
      const result = await redeemLoginKey(pool, email, "000000");
      assert.equal(result.error, "bad_key");
    }
    const locked = await redeemLoginKey(pool, email, "000000");
    assert.equal(locked.error, "too_many");
    assert.equal(locked.status, 429);
    assert.ok(locked.retryAfter > 0, "客户端要拿到准确的重试秒数");
    assert.ok(loginLockRemaining(email) > 0);
  } finally {
    resetLoginGuard();
  }
});

test("a correct key clears the count, so a typo or two never accumulates", async () => {
  resetLoginGuard();
  try {
    const email = "paul@example.com";
    const { pool: bad } = badKeyPool();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i += 1) {
      assert.equal((await redeemLoginKey(bad, email, "000000")).error, "bad_key");
    }
    const { pool: good } = redeemPool(() => ({ rows: [{ id: "user-1", points_balance: 100, role: "user" }] }));
    assert.equal((await redeemLoginKey(good, email, "048291")).userId, "user-1");
    assert.equal(loginLockRemaining(email), 0);
    // 清零之后又能错满一整轮，说明计数没有跟着上一次的失败继续算。
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i += 1) {
      assert.equal((await redeemLoginKey(bad, email, "000000")).error, "bad_key");
    }
    assert.equal(loginLockRemaining(email), 0);
  } finally {
    resetLoginGuard();
  }
});

test("the lock lifts once its window has passed", async () => {
  resetLoginGuard();
  try {
    const email = "late@example.com";
    const { pool } = badKeyPool();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i += 1) await redeemLoginKey(pool, email, "000000");
    assert.ok(loginLockRemaining(email) > 0);
    assert.equal(loginLockRemaining(email, Date.now() + LOGIN_LOCK_MS + 1), 0);
  } finally {
    resetLoginGuard();
  }
});

test("a failure that is not a wrong key does not count against the mailbox", async () => {
  resetLoginGuard();
  try {
    // 冻结注册返回 registration_closed：那不是猜码，记进去会让正常用户
    // 在自己的注册窗口里被锁死。
    const email = "closed@example.com";
    installSystemPolicy({ registrationMode: "closed" });
    try {
      const pool = poolWith((sql) => {
        if (sql.includes("UPDATE login_keys")) return { rowCount: 1, rows: [{ id: "key-1", invite_code_id: null }] };
        if (sql.includes("role = 'owner'")) return { rows: [] };
        if (sql.includes("INSERT INTO accounts")) {
          return { rows: [{ id: "user-9", points_balance: 0, role: "user", inserted: true }] };
        }
        throw new Error(sql);
      });
      for (let i = 0; i < LOGIN_MAX_FAILURES * 2; i += 1) {
        assert.equal((await redeemLoginKey(pool, email, "048291")).error, "registration_closed");
      }
      assert.equal(loginLockRemaining(email), 0);
    } finally {
      resetSystemPolicy();
    }
  } finally {
    resetLoginGuard();
  }
});
