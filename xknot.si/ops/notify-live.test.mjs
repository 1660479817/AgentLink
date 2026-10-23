// 「已上线」通知：接在验收上、只发一封、发不出去也不拦验收。

import assert from "node:assert/strict";
import test from "node:test";

import { notifyLive } from "./notify-live.mjs";

const APPLICATION = {
  id: "XK-2026-M5CMKG",
  name: "cpswang",
  url: "https://cpswang.xknot.si",
  subdomain: "cpswang",
  email: "partner@example.com",
  operator: "cpswang",
  locale: "zh-CN",
};

const ENV = {
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  MAIL_FROM: "noreply@xknot.si",
  XKNOT_ADMIN_EMAIL: "ops@xknot.si",
  XKNOT_PUBLIC_ORIGIN: "https://xknot.si",
};

function fakeStore(overrides = {}) {
  const calls = { reserved: [], finished: [] };
  return {
    calls,
    // 默认没有任何历史记录；overrides.notifyLog 用来模拟「之前发过」。
    listNotifyLog(_limit, _caseId) {
      return overrides.notifyLog || [];
    },
    beginNotify(payload) {
      calls.reserved.push(payload);
      if (overrides.duplicate) return { duplicate: true };
      return { id: 7, at: "2026-10-23T10:00:00Z" };
    },
    finishNotify(id, payload) {
      calls.finished.push({ id, ...payload });
      return 1;
    },
  };
}

test("live: the acceptance sends one mail and logs it as sent", async () => {
  const store = fakeStore();
  const delivered = [];
  const result = await notifyLive({
    store,
    application: APPLICATION,
    env: ENV,
    deliver: async (_config, message) => delivered.push(message),
  });

  assert.deepEqual(result, { sent: true, id: 7 });
  assert.equal(delivered.length, 1);
  // 信里必须有实例、地址与健康检查地址：伙伴照着这一封就能自查。
  assert.match(delivered[0].subject, /XK-2026-M5CMKG 已在联邦上线/);
  assert.match(delivered[0].text, /cpswang/);
  assert.match(delivered[0].text, /https:\/\/cpswang\.xknot\.si/);
  assert.match(delivered[0].text, /https:\/\/cpswang\.xknot\.si\/api\/health/);
  assert.equal(delivered[0].to, "partner@example.com");
  // 去重键是事件 + 申请号 + 版本 1：自动发的这封信不允许发第二遍。
  assert.equal(store.calls.reserved[0].event, "partner.live");
  assert.equal(store.calls.reserved[0].caseId, "XK-2026-M5CMKG");
  assert.equal(store.calls.reserved[0].stateVersion, 1);
  assert.deepEqual(store.calls.finished, [{ id: 7, status: "sent" }]);
});

test("live: no SMTP config skips quietly instead of failing the activation", async () => {
  const store = fakeStore();
  const result = await notifyLive({ store, application: APPLICATION, env: {} });
  assert.deepEqual(result, { skipped: "no_smtp" });
  assert.equal(store.calls.reserved.length, 0);
});

test("live: a mail already sent for this application is not sent twice", async () => {
  // 手打过 admin-cli live 的单子，state_version 是 NULL，索引拦不住；
  // 所以按事件查一遍历史，发过的就不再发。
  const store = fakeStore({ notifyLog: [{ event: "partner.live", status: "sent" }] });
  const delivered = [];
  const result = await notifyLive({
    store,
    application: APPLICATION,
    env: ENV,
    deliver: async (_config, message) => delivered.push(message),
  });
  assert.deepEqual(result, { skipped: "already_sent" });
  assert.equal(delivered.length, 0);
  assert.equal(store.calls.reserved.length, 0);
});

test("live: a failed earlier attempt is retried, not treated as sent", async () => {
  const store = fakeStore({ notifyLog: [{ event: "partner.live", status: "failed" }] });
  const delivered = [];
  const result = await notifyLive({
    store,
    application: APPLICATION,
    env: ENV,
    deliver: async (_config, message) => delivered.push(message),
  });
  assert.equal(result.sent, true);
  assert.equal(delivered.length, 1);
});

test("live: an index conflict still counts as already sent", async () => {
  const store = fakeStore({ duplicate: true });
  const delivered = [];
  const result = await notifyLive({
    store,
    application: APPLICATION,
    env: ENV,
    deliver: async (_config, message) => delivered.push(message),
  });
  assert.deepEqual(result, { skipped: "already_sent" });
  assert.equal(delivered.length, 0);
});

test("live: a delivery failure is recorded, not retried", async () => {
  const store = fakeStore();
  const result = await notifyLive({
    store,
    application: APPLICATION,
    env: ENV,
    deliver: async () => {
      throw new Error("connection refused");
    },
  });
  assert.deepEqual(result, { failed: "connection refused" });
  assert.deepEqual(store.calls.finished, [{ id: 7, status: "failed", error: "connection refused" }]);
});

test("live: an application without a recipient is skipped before reserving the slot", async () => {
  const store = fakeStore();
  const result = await notifyLive({
    store,
    application: { ...APPLICATION, email: "" },
    env: ENV,
  });
  assert.deepEqual(result, { skipped: "no_recipient" });
  assert.equal(store.calls.reserved.length, 0);
});
