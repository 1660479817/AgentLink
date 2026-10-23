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
