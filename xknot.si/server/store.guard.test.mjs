import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { openStore } from "./store.mjs";

// 这一份专门盯「并发与坏数据」那几条约束：子域唯一、接通 run 的坏行、
// 发信日志的重试与回收、最后一个管理员。都靠真实的 SQLite 文件验，
// :memory: 上的临时库跑不出跨进程要挡的那种交错。

function withStore(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-guard-"));
  const file = path.join(dir, "xknot.db");
  const store = openStore(file);
  t.after(() => {
    try {
      store.close();
    } catch {
      // 用例自己先关过（重开库那条），这里不再关一次。
    }
    rmSync(dir, { recursive: true, force: true });
  });
  return { store, file };
}

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

const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterialForTests case";

test("subdomain: a second approved application for the same label is a 409, not a 500", (t) => {
  const { store } = withStore(t);
  const first = store.createApplication(applicationInput());
  assert.equal(first.subdomain, "cpswang");

  // 唯一索引只覆盖 status = 'approved'。同一子域再来一单必须是 duplicate，
  // 让接口层回 409；漏成异常就变成 500，运营看不出是被占了。
  assert.deepEqual(store.createApplication(applicationInput()), { error: "duplicate" });

  // 撤回之后标签空出来，可以再签一次。
  store.withdrawApplication(first.id);
  const again = store.createApplication(applicationInput());
  assert.equal(again.error, undefined);
  assert.equal(again.subdomain, "cpswang");
  assert.ok(store.takenSubdomains().includes("cpswang"));
});

test("provision: a corrupt run row is visible, selected again, and overwritten", (t) => {
  const { store, file } = withStore(t);
  const application = store.createApplication(applicationInput());
  store.setPublicKey({ id: application.id, publicKey: PUBLIC_KEY });

  const hook = new DatabaseSync(file);
  hook
    .prepare("insert into provision_runs (application_id, run, created_at, updated_at) values (?, ?, ?, ?)")
    .run(application.id, '{"state":"running"', "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  hook.close();

  // 坏行不能当成 null：null 与「还没有 run」长得一样，案例页会静默停住。
  const run = store.getProvisionRun(application.id);
  assert.equal(run.corrupt, true);
  assert.equal(run.applicationId, application.id);

  const listed = store.listProvisionRuns(10);
  assert.equal(listed[0].corrupt, true);
  assert.equal(listed[0].lastError, "run_corrupt");

  // left join 必须还选中它，worker 才有机会重来。
  assert.deepEqual(
    store.applicationsAwaitingProvision().map((row) => row.id),
    [application.id]
  );

  // 覆盖坏行是唯一出路；正常的 run 不会被这样顶掉。
  const fresh = store.createProvisionRun({ applicationId: application.id, state: "pending", steps: [] });
  assert.equal(fresh.state, "pending");
  assert.equal(fresh.corrupt, undefined);
  const blocked = store.createProvisionRun({ applicationId: application.id, state: "running", steps: [] });
  assert.equal(blocked.state, "pending", "已有可用 run 时重跑不该覆盖");
});

test("public key: a withdrawn application refuses the key instead of bumping its version", (t) => {
  const { store } = withStore(t);
  const application = store.createApplication(applicationInput());
  store.withdrawApplication(application.id);

  assert.deepEqual(store.setPublicKey({ id: application.id, publicKey: PUBLIC_KEY }), {
    error: "not_approved",
  });
  assert.equal(store.getApplication(application.id).publicKey, null);
  assert.equal(store.getApplication(application.id).stateVersion, 1, "撤回那一步的版本，没被写公钥推高");

  // 换行就是往 authorized_keys 里追加第二行，必须挡在落库之前。
  const fresh = store.createApplication(applicationInput({ subdomain: "second" }));
  assert.deepEqual(
    store.setPublicKey({ id: fresh.id, publicKey: `${PUBLIC_KEY}\nssh-rsa AAAAB3NzaC1yc2E` }),
    { error: "bad_public_key" }
  );
});

test("notify: a failed send can be retried on the same key, a sent one cannot", (t) => {
  const { store } = withStore(t);
  const first = store.beginNotify({ event: "application.approved", caseId: "XK-1", stateVersion: 0 });
  assert.ok(first.id > 0);

  // 还在途：同一幂等键再来一次按 duplicate 回，不能重复发。
  assert.deepEqual(
    store.beginNotify({ event: "application.approved", caseId: "XK-1", stateVersion: 0 }),
    { duplicate: true }
  );

  // 发失败：SMTP 抖一次不该让这封信永久发不出去。
  assert.equal(store.finishNotify(first.id, { status: "failed", error: "smtp_timeout" }), 1);
  const retry = store.beginNotify({ event: "application.approved", caseId: "XK-1", stateVersion: 0 });
  assert.equal(retry.id, first.id, "重试复用原来那一行，日志里仍是一条事件");
  assert.equal(retry.retried, true);

  // 这一次成功，之后就是真正的重复。
  store.finishNotify(first.id, { status: "sent" });
  assert.deepEqual(
    store.beginNotify({ event: "application.approved", caseId: "XK-1", stateVersion: 0 }),
    { duplicate: true }
  );
  assert.equal(store.listNotifyLog(10, "XK-1").length, 1);
});

test("relay: a stale pending row is reclaimed as unknown, not deleted", (t) => {
  const { store, file } = withStore(t);
  const token = store.createRelayToken({ instanceId: "cpswang", label: "委托", dailyLimit: 50 });
  const since = new Date(Date.now() - 86400000).toISOString();

  const reserved = store.reserveRelay({
    instanceId: "cpswang",
    tokenId: token.record.id,
    sinceIso: since,
    limit: 50,
    toDomain: "example.com",
    idemKey: "msg-1",
  });
  assert.ok(reserved.id > 0);

  // 进程在发信途中退出：占位留在 pending。把它改成很久以前，等回收。
  const hook = new DatabaseSync(file);
  hook
    .prepare("update relay_log set at = ? where seq = ?")
    .run(new Date(Date.now() - 60 * 60000).toISOString(), reserved.id);
  hook.close();

  assert.equal(store.pruneStaleRelayPending(15), 1);

  // 不能删行：SMTP 可能已经收下，删了幂等键就会再投一封。
  const sameKey = store.reserveRelay({
    instanceId: "cpswang",
    tokenId: token.record.id,
    sinceIso: since,
    limit: 50,
    toDomain: "example.com",
    idemKey: "msg-1",
  });
  assert.equal(sameKey.duplicate?.id, reserved.id);
  assert.equal(sameKey.duplicate.pending, false, "unknown 不算在途，实例可以自行决定要不要换键");

  // 回收掉的那条仍占当天额度：它可能真的发出去了。同键不会再多插一行。
  assert.equal(store.relayUsage(token.record.id, since), 1);
  assert.equal(store.listRelayLog(10)[0].status, "unknown");
});

test("admin: the last account cannot be deleted, even from two consoles", (t) => {
  const { store } = withStore(t);
  const paul = store.createAdmin({ username: "paul", password: "correct-horse-battery" });
  assert.equal(paul.admin.username, "paul");

  assert.deepEqual(store.deleteAdmin("paul"), { error: "last_admin" });
  assert.equal(store.listAdmins().length, 1);

  store.createAdmin({ username: "lin", password: "correct-horse-battery" });
  assert.deepEqual(store.deleteAdmin("lin"), { ok: true });
  assert.deepEqual(store.listAdmins().map((row) => row.username), ["paul"]);

  // 大写与空格走同一条规范化路径，不然删不掉也挡不住。
  assert.deepEqual(store.deleteAdmin("  PAUL "), { error: "last_admin" });
});

test("schema: an existing database is not migrated twice", (t) => {
  const { store, file } = withStore(t);
  store.createApplication(applicationInput({ subdomain: "" , url: "https://example.com" }));
  store.close();

  // 再打开一次：user_version 已经写过，破坏性的 UPDATE 不该再跑一遍。
  // 断言对的是「最后一个迁移的版本号」，加新迁移时一起跟着改。
  const reopened = openStore(file);
  t.after(() => reopened.close());
  const db = new DatabaseSync(file, { readOnly: true });
  assert.equal(Number(db.prepare("pragma user_version").get().user_version), 3);
  db.close();
  assert.equal(reopened.listApplications().length, 1);
});
