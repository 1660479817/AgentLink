import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { hashPassword, openStore, verifyPassword } from "./store.mjs";

// 老库是 create table if not exists 建出来的，后来加的列只能靠 migrate() 补。
// 这一段照着最早的表结构建库，确认现在还能直接打开，不会被索引卡住。
const OLD_SCHEMA = `
create table applications (
  id           text primary key,
  name         text not null,
  url          text not null,
  operator     text not null,
  email        text not null,
  region       text not null,
  timezone     text not null,
  intro        text not null,
  tags         text not null default '[]',
  locale       text,
  status       text not null default 'pending',
  created_at   text not null,
  reviewed_at  text,
  reviewed_by  text,
  review_note  text,
  ip_hash      text
);
create index applications_status on applications(status, created_at);
create index applications_url on applications(url);
`;

function withTempDb(t, seed) {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-store-"));
  const file = path.join(dir, "xknot.db");
  if (seed) {
    const db = new DatabaseSync(file);
    db.exec(OLD_SCHEMA);
    seed(db);
    db.close();
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return file;
}

test("old database opens: missing columns are added, case_key is filled, index exists", (t) => {
  const file = withTempDb(t, (db) => {
    db.prepare(
      `insert into applications (id, name, url, operator, email, region, timezone, intro, status, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "XK-2025-OLD001",
      "老条目",
      "https://nordhavn.xknot.si",
      "Lin",
      "lin@example.com",
      "NO",
      "Europe/Oslo",
      "旧库里的申请。",
      "approved",
      "2025-01-01T00:00:00.000Z"
    );
  });

  const store = openStore(file);
  t.after(() => store.close());

  const [row] = store.listApplications({ status: "approved" });
  assert.equal(row.id, "XK-2025-OLD001");
  assert.match(row.caseKey, /^[A-Za-z0-9_-]{8,}$/);
  assert.equal(row.stateVersion, 0);

  const db = new DatabaseSync(file, { readOnly: true });
  const indexes = db.prepare("pragma index_list(applications)").all().map((entry) => entry.name);
  const columns = db.prepare("pragma table_info(applications)").all().map((entry) => entry.name);
  db.close();
  assert.ok(indexes.includes("applications_case"));
  assert.ok(columns.includes("public_key"));
  assert.ok(columns.includes("reviewed_by"));
});

test("password reset on an old database makes the new password valid", (t) => {
  const file = withTempDb(t, (db) => {
    db.exec(
      "create table admins (id text primary key, username text not null unique, password_hash text not null, created_at text not null, last_login_at text)"
    );
    db.prepare("insert into admins (id, username, password_hash, created_at) values (?, ?, ?, ?)").run(
      "admin-1",
      "paul",
      hashPassword("forgotten"),
      "2025-01-01T00:00:00.000Z"
    );
  });

  const store = openStore(file);
  t.after(() => store.close());

  store.setPassword("paul", "correct-horse-battery");
  assert.equal(store.verifyAdmin({ username: "paul", password: "correct-horse-battery" })?.username, "paul");
  assert.equal(store.verifyAdmin({ username: "paul", password: "forgotten" }), null);

  const row = new DatabaseSync(file, { readOnly: true })
    .prepare("select password_hash from admins where username = ?")
    .get("paul");
  assert.ok(verifyPassword("correct-horse-battery", row.password_hash));
});

// 下面几条都从这一份申请起步：字段够 createApplication 直接落库。
function applicationInput(overrides = {}) {
  return {
    name: "cpswang",
    subdomain: "cpswang",
    operator: "Paul",
    email: "manwjh@126.com",
    region: "CN",
    timezone: "Asia/Shanghai",
    intro: "自用实例。",
    ...overrides,
  };
}

test("claim: a token issued before a withdrawal cannot be redeemed", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());
  const issued = store.createClaimToken({
    applicationId: application.id,
    payload: "XKNOT_HUB_RELAY_TOKEN=xkr_cpswang_x",
  });

  // 撤回之后，没核销的令牌不该还能换出委托发信凭据与隧道参数。
  assert.equal(store.withdrawApplication(application.id).error, undefined);
  assert.deepEqual(store.consumeClaimToken(issued.token), { error: "application_closed" });
});

test("claim: reissuing revokes the link from the previous mail", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());
  const first = store.createClaimToken({ applicationId: application.id, payload: "old" });
  const second = store.rotateClaimToken({ applicationId: application.id, payload: "new" });

  assert.deepEqual(second.revoked, [{ id: first.id, applicationId: application.id }]);
  // 旧链接换不出旧资料，新链接拿到的是新资料。
  assert.deepEqual(store.consumeClaimToken(first.token), { error: "revoked" });
  assert.equal(store.consumeClaimToken(second.token).payload, "new");

  // 作废与领取分开记：审计要能看出是运营方收回的，不是伙伴领走的。
  const rows = store.listClaimTokens({ applicationId: application.id });
  assert.deepEqual(rows.map((row) => row.id), [second.id, first.id]);
  assert.equal(rows.find((row) => row.id === first.id).revokedAt !== null, true);
  assert.equal(rows.find((row) => row.id === first.id).usedAt, null);
});

test("claim: reissuing leaves claimed links, expiry, and other applications alone", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());
  const other = store.createApplication(applicationInput({ subdomain: "nordhavn", email: "lin@example.com" }));
  const claimed = store.createClaimToken({ applicationId: application.id, payload: "claimed" });
  const live = store.createClaimToken({ applicationId: application.id, payload: "live" });
  const elsewhere = store.createClaimToken({ applicationId: other.id, payload: "other" });

  assert.equal(store.consumeClaimToken(claimed.token).payload, "claimed");
  const reissued = store.rotateClaimToken({ applicationId: application.id, payload: "again" });

  // 已领走的那条是历史，不该被改写成「作废」。
  assert.deepEqual(reissued.revoked, [{ id: live.id, applicationId: application.id }]);
  const rows = store.listClaimTokens({ applicationId: application.id });
  assert.equal(rows.find((row) => row.id === claimed.id).usedAt !== null, true);
  assert.equal(rows.find((row) => row.id === claimed.id).revokedAt, null);
  // 别的申请单上的链接与这次重发无关。
  assert.equal(store.consumeClaimToken(elsewhere.token).payload, "other");
});

test("claim: revoking by application id only takes the outstanding links", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());
  const claimed = store.createClaimToken({ applicationId: application.id, payload: "claimed" });
  const live = store.createClaimToken({ applicationId: application.id, payload: "live" });
  assert.equal(store.consumeClaimToken(claimed.token).payload, "claimed");

  const result = store.revokeClaimTokens(application.id);
  assert.deepEqual(result.revoked, [{ id: live.id, applicationId: application.id }]);
  assert.deepEqual(store.consumeClaimToken(live.token), { error: "revoked" });

  // 再收一次没有可收的：作废是幂等的，不会把已领走的改写成作废。
  assert.deepEqual(store.revokeClaimTokens(application.id).revoked, []);
  assert.deepEqual(store.revokeClaimTokens("clm_nope"), { revoked: [] });
});

test("claim: two redemptions of the same token cannot both win", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());
  const issued = store.createClaimToken({
    applicationId: application.id,
    payload: "XKNOT_HUB_RELAY_TOKEN=xkr_cpswang_x",
  });

  // 模拟两个请求同时打同一枚令牌：这一边读到 used_at 为空之后、写库之前，
  // 让另一个进程先把它核销掉。核销必须是一条带 used_at is null 的 UPDATE，
  // 先查后写的写法会在这里再成功一次。
  const prepare = store.db.prepare.bind(store.db);
  let raced = false;
  store.db.prepare = (sql) => {
    const statement = prepare(sql);
    if (raced || !/^select/i.test(sql) || !/from claim_tokens/i.test(sql)) return statement;
    return {
      get: (...args) => {
        const row = statement.get(...args);
        prepare("update claim_tokens set used_at = ? where token_hash = ?").run(
          "2026-01-01T00:00:00.000Z",
          args[0]
        );
        raced = true;
        return row;
      },
    };
  };
  try {
    assert.deepEqual(store.consumeClaimToken(issued.token), { error: "already_used" });
  } finally {
    store.db.prepare = prepare;
  }
});

test("transition: a stale read cannot migrate twice", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());

  // 模拟两个进程交错：这一边读到的是 approved，另一个进程在这之后先撤回了。
  const stale = store.getApplication(application.id);
  store.withdrawApplication(application.id);
  const read = store.getApplication;
  store.getApplication = () => stale;
  try {
    assert.deepEqual(store.transition({ id: application.id, to: "withdrawn" }), {
      error: "invalid_transition",
      from: "approved",
      to: "withdrawn",
    });
  } finally {
    store.getApplication = read;
  }

  const after = store.getApplication(application.id);
  assert.equal(after.status, "withdrawn");
  assert.equal(after.stateVersion, 1, "前态条件挡住第二次迁移，版本号只 +1");
  assert.equal(store.events(200).filter((row) => row.kind === "application.withdrawn").length, 1);
});

test("transition: the status change and its event are written together", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const application = store.createApplication(applicationInput());
  // 让写事件这一步失败（等价于磁盘满，或进程在两条语句之间被杀）：
  // 状态迁移必须跟着回滚，不能留下「已撤回、没有事件」的半成品。
  const hook = new DatabaseSync(file);
  hook.exec(
    `create trigger refuse_withdrawn before insert on events
       when new.kind = 'application.withdrawn'
       begin select raise(abort, 'refuse'); end`
  );
  hook.close();

  assert.throws(() => store.withdrawApplication(application.id), /refuse/);
  const after = store.getApplication(application.id);
  assert.equal(after.status, "approved");
  assert.equal(after.closedAt, null);
});

test("relay: issuing a new credential revokes the old one", (t) => {
  const file = withTempDb(t);
  const store = openStore(file);
  t.after(() => store.close());

  const other = store.rotateRelayToken({ instanceId: "wang", label: "别的实例" });
  const first = store.rotateRelayToken({ instanceId: "cpswang", label: "第一次" });
  const second = store.rotateRelayToken({ instanceId: "cpswang", label: "第二次" });

  // 重领即作废：旧件立刻失效，新件可用，别的实例不受影响。
  assert.deepEqual(second.revoked, [first.record.id]);
  assert.deepEqual(store.verifyRelayToken(first.token), { error: "revoked" });
  assert.equal(store.verifyRelayToken(second.token).token.id, second.record.id);
  assert.equal(store.verifyRelayToken(other.token).token.id, other.record.id);
});

test("migration v2: a leftover verify_tokens table is dropped", (t) => {
  const file = withTempDb(t, (db) => {
    // 2.0 之前归属验证流程留下的表，代码里已无引用；迁移 v2 要把它清掉。
    db.exec(
      "create table verify_tokens (token_hash text, application_id text, created_at text, expires_at text, used_at text)"
    );
  });

  const store = openStore(file);
  t.after(() => store.close());

  const db = new DatabaseSync(file, { readOnly: true });
  const names = db
    .prepare("select name from sqlite_master where type = 'table' and name = 'verify_tokens'")
    .all();
  db.close();
  assert.equal(names.length, 0, "verify_tokens 应该在迁移 v2 里被 drop");
});

test("migration v3: a revocation borrowed from used_at becomes revoked_at", (t) => {
  const file = withTempDb(t, (db) => {
    // 3.0 之前的领取表没有 revoked_at：作废借用 used_at，审计上跟「领走了」分不清。
    db.exec(`
      create table claim_tokens (
        id             text primary key,
        token_hash     text not null unique,
        application_id text not null,
        payload        text not null,
        created_at     text not null,
        expires_at     text not null,
        used_at        text,
        created_by     text
      );
      create table events (
        seq    integer primary key autoincrement,
        at     text not null,
        kind   text not null,
        ref    text,
        detail text
      );
      insert into claim_tokens (id, token_hash, application_id, payload, created_at, expires_at, used_at)
      values ('clm_old', 'hash-old', 'XK-1', 'old', '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
             ('clm_new', 'hash-new', 'XK-1', 'new', '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z', null);
      insert into events (at, kind, ref, detail) values
        ('2026-01-02T00:00:00.000Z', 'claim.revoked', 'XK-1', 'clm_old'),
        ('2026-01-02T00:00:00.000Z', 'claim.consumed', 'XK-1', 'clm_missing');
    `);
  });

  const store = openStore(file);
  t.after(() => store.close());

  const rows = store.listClaimTokens({ applicationId: "XK-1" });
  const old = rows.find((row) => row.id === "clm_old");
  // 事件表说它被作废过：搬进 revoked_at，used_at 清空，状态才不是「已领取」。
  assert.equal(old.revokedAt, "2026-01-02T00:00:00.000Z");
  assert.equal(old.usedAt, null);
  assert.equal(rows.find((row) => row.id === "clm_new").revokedAt, null);
});
