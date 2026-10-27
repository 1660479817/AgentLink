import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApp } from "./app.mjs";
import { isAllowedReplyTo, validateRelayRequest } from "./relay.mjs";
import { openMemoryStore } from "./store.mjs";

const instance = {
  id: "nordhavn",
  name: { en: "Knot · nordhavn" },
  url: "https://nordhavn.example",
  contact: "ops@nordhavn.example",
  status: "active",
};

function recordingMailer({ fail = false, delayMs = 0 } = {}) {
  const sent = [];
  return {
    from: "notify@mail.xknot.si",
    sent,
    async send(message) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (fail) {
        const error = new Error("smtp_down");
        error.code = "smtp_command";
        throw error;
      }
      sent.push(message);
    },
  };
}

async function start(
  t,
  { mailer = recordingMailer(), instances = [instance], instancesProvider, enabled = true, dailyLimit = 50 } = {}
) {
  const store = openMemoryStore();
  const { handle } = createApp({
    store,
    config: {
      secret: "test",
      adminDir: null,
      mailer,
      origin: "https://xknot.si",
      instances,
      instancesProvider,
      relay: { enabled, dailyLimit },
    },
  });
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end();
      else res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  async function call(path, { method = "GET", body, token } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, data, headers: response.headers };
  }

  return { store, call, mailer };
}

function issue(store, options = {}) {
  return store.createRelayToken({ instanceId: instance.id, ...options }).token;
}

const message = {
  to: "lin@example.com",
  subject: "验证你的邮箱",
  text: "点这个链接完成验证。",
};

test("relay: a plain message passes and falls back to the instance contact", () => {
  const checked = validateRelayRequest(message, { instance, from: "notify@mail.xknot.si" });
  assert.equal(checked.ok, true);
  assert.equal(checked.value.replyTo, "ops@nordhavn.example");
});

test("relay: reply-to must belong to the instance", () => {
  assert.equal(isAllowedReplyTo("help@nordhavn.example", instance), true);
  assert.equal(isAllowedReplyTo("mail.nordhavn.example", instance), false);

  const good = validateRelayRequest({ ...message, replyTo: "support@nordhavn.example" }, { instance });
  assert.equal(good.ok, true);

  const foreign = validateRelayRequest({ ...message, replyTo: "ceo@evil.example" }, { instance });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.errors.replyTo, "foreign_domain");
});

test("relay: a contact on a shared mail host does not open that whole host", () => {
  // contact 写在 gmail 上时，按主机放行等于允许把回复指向 gmail 里任何一个人，
  // 回信就顶着中枢的发信信誉寄给陌生人。只认与 contact 完全一致的那个地址。
  const gmail = { ...instance, contact: "nordhavn.site@gmail.com" };
  assert.equal(isAllowedReplyTo("nordhavn.site@gmail.com", gmail), true);
  assert.equal(isAllowedReplyTo("someone.else@gmail.com", gmail), false);
  assert.equal(validateRelayRequest({ ...message, replyTo: "someone.else@gmail.com" }, { instance: gmail }).ok, false);

  // 站点自己的域名仍然整域放行：那是这一家能自主管理的地址空间。
  const own = { ...instance, contact: "ops@mail.nordhavn.example" };
  assert.equal(isAllowedReplyTo("support@nordhavn.example", own), true);
});

test("relay: header injection, display names and over-long text are refused", () => {
  const injected = validateRelayRequest({ ...message, subject: "hi\r\nBcc: x@y.z" }, { instance });
  assert.equal(injected.errors.subject, "newline");

  const named = validateRelayRequest({ ...message, to: "Lin <lin@example.com>" }, { instance });
  assert.equal(named.errors.to, "invalid_address");

  const long = validateRelayRequest({ ...message, text: "长".repeat(4001) }, { instance });
  assert.equal(long.errors.text, "too_long");

  const self = validateRelayRequest({ ...message, to: "notify@mail.xknot.si" }, {
    instance,
    from: "notify@mail.xknot.si",
  });
  assert.equal(self.errors.to, "self_address");

  const idem = validateRelayRequest({ ...message, idempotencyKey: "bad key!" }, { instance });
  assert.equal(idem.errors.idempotencyKey, "invalid");
});

test("store: tokens are stored hashed, revocable and bound to an instance", () => {
  const store = openMemoryStore();
  const created = store.createRelayToken({ instanceId: "nordhavn", label: "验证邮件", dailyLimit: 5 });
  assert.match(created.token, /^xkr_nordhavn_/);
  assert.equal(store.verifyRelayToken(created.token).token.instanceId, "nordhavn");
  assert.equal(store.verifyRelayToken("nope").error, "invalid");

  const listed = store.listRelayTokens();
  assert.equal(listed.length, 1);
  assert.ok(!JSON.stringify(listed).includes(created.token));

  assert.equal(store.revokeRelayToken(created.record.id).revoked, 1);
  assert.equal(store.verifyRelayToken(created.token).error, "revoked");
  store.close();
});

test("store: the per-instance switch pauses one instance without touching its credential", () => {
  const store = openMemoryStore();
  const north = store.createRelayToken({ instanceId: "nordhavn", dailyLimit: 50 });
  const other = store.createRelayToken({ instanceId: "cpswang", dailyLimit: 50 });
  assert.equal(store.relaySwitch("nordhavn").disabled, false);

  const off = store.setRelaySwitch("nordhavn", { disabled: true, note: "退信率升高", by: "cli" });
  assert.equal(off.disabled, true);
  assert.deepEqual(store.listRelaySwitches().map((row) => row.instanceId), ["nordhavn"]);
  // 关的是「受理」，不是凭据：令牌照样校验通过，额度与记录都没动。
  assert.equal(store.verifyRelayToken(north.token).token.instanceId, "nordhavn");
  assert.equal(store.relaySwitch("cpswang").disabled, false);
  assert.equal(store.listRelayTokens().filter((row) => !row.revokedAt).length, 2);

  store.setRelaySwitch("nordhavn", { disabled: false });
  assert.equal(store.relaySwitch("nordhavn").disabled, false);
  assert.equal(store.listRelaySwitches().length, 0);

  assert.equal(store.setRelaySwitch("Bad Id", { disabled: true }).error, "invalid_instance");
  // 吊销仍然是另一件事：它让凭据本身作废，两条路径互不影响。
  store.revokeRelayToken(other.record.id);
  store.setRelaySwitch("cpswang", { disabled: true });
  assert.equal(store.verifyRelayToken(other.token).error, "revoked");
  store.close();
});

test("store: relay reservations hold quota, dedupe in-flight keys and expire", () => {
  const store = openMemoryStore();
  const token = store.createRelayToken({ instanceId: "nordhavn", dailyLimit: 5 }).record;
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const base = {
    instanceId: "nordhavn",
    tokenId: token.id,
    sinceIso: since,
    limit: 5,
    toDomain: "example.com",
    subjectLength: 1,
  };

  const first = store.reserveRelay({ ...base, idemKey: "same" });
  assert.ok(first.id);
  const duplicate = store.reserveRelay({ ...base, idemKey: "same" });
  assert.equal(duplicate.duplicate.id, first.id);
  assert.equal(duplicate.duplicate.pending, true);

  const other = store.reserveRelay({ ...base, idemKey: "other" });
  assert.ok(other.id);
  assert.equal(store.relayUsage(token.id, since), 2);

  store.finishRelay(first.id, { status: "failed", error: "smtp_down" });
  const retry = store.reserveRelay({ ...base, idemKey: "same" });
  assert.ok(retry.id, "a failed attempt may be retried with the same key");
  store.finishRelay(retry.id, { status: "accepted" });

  // 幂等窗口是 24 小时：更早的成功记录不应该永远挡住同一个键。
  store.db.prepare("update relay_log set at = ? where seq = ?").run(
    new Date(Date.now() - 25 * 3600_000).toISOString(),
    retry.id
  );
  const reuse = store.reserveRelay({ ...base, idemKey: "same" });
  assert.ok(reuse.id);
  assert.notEqual(reuse.id, retry.id);

  // 进程在发信途中退出留下的 pending 占位会被回收。
  store.db.prepare("update relay_log set at = ? where seq = ?").run(
    new Date(Date.now() - 60 * 60_000).toISOString(),
    other.id
  );
  assert.equal(store.pruneStaleRelayPending(15), 1);
  store.close();
});

test("relay api: missing and unknown tokens are rejected", async (t) => {
  const { call } = await start(t);
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message })).status, 401);
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token: "xkr_ghost" })).status, 401);
});

test("relay api: instances not in the manifest or not active are refused", async (t) => {
  const { store, call } = await start(t);
  const token = issue(store);
  const inactive = await start(t, {
    instances: [{ ...instance, status: "suspended" }],
    dailyLimit: 5,
  });
  const inactiveToken = issue(inactive.store);
  assert.equal((await inactive.call("/api/federation/mail", { method: "POST", body: message, token: inactiveToken })).status, 403);

  const unlisted = await start(t, { instances: [] });
  const unlistedToken = issue(unlisted.store);
  assert.equal((await unlisted.call("/api/federation/mail", { method: "POST", body: message, token: unlistedToken })).status, 403);

  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);
});

test("relay api: re-reads the manifest so pause and publish apply without a restart", async (t) => {
  let manifest = [instance];
  const { store, call } = await start(t, { instancesProvider: () => manifest });
  const token = issue(store);

  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);

  manifest = [{ ...instance, status: "suspended" }];
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 403);

  manifest = [];
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 403);
});

test("relay api: a valid message is sent once and stamped with the instance", async (t) => {
  const { store, call, mailer } = await start(t);
  const token = issue(store);
  const result = await call("/api/federation/mail", { method: "POST", body: message, token });

  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(mailer.sent.length, 1);
  assert.equal(mailer.sent[0].to, "lin@example.com");
  assert.equal(mailer.sent[0].replyTo, "ops@nordhavn.example");
  assert.deepEqual(mailer.sent[0].headers, ["X-XKnot-Instance: nordhavn"]);

  const quota = await call("/api/federation/mail", { token });
  assert.equal(quota.status, 200);
  assert.equal(quota.data.quota.used, 1);
  assert.equal(quota.data.quota.remaining, 49);
});

test("relay api: invalid fields come back as per-field codes", async (t) => {
  const { store, call, mailer } = await start(t);
  const token = issue(store);
  const result = await call("/api/federation/mail", {
    method: "POST",
    body: { ...message, to: "nope", replyTo: "x@evil.example" },
    token,
  });
  assert.equal(result.status, 400);
  assert.equal(result.data.error, "invalid");
  assert.equal(result.data.fields.to, "invalid_address");
  assert.equal(result.data.fields.replyTo, "foreign_domain");
  assert.equal(mailer.sent.length, 0);
});

test("relay api: the same idempotency key does not send twice", async (t) => {
  const { store, call, mailer } = await start(t);
  const token = issue(store);
  const body = { ...message, idempotencyKey: "verify-8f3c" };
  const first = await call("/api/federation/mail", { method: "POST", body, token });
  const second = await call("/api/federation/mail", { method: "POST", body, token });

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.data.duplicate, true);
  assert.equal(mailer.sent.length, 1);
});

test("relay api: concurrent sends with the same idempotency key send once", async (t) => {
  const { store, call, mailer } = await start(t, { mailer: recordingMailer({ delayMs: 30 }) });
  const token = issue(store);
  const body = { ...message, idempotencyKey: "concurrent-same-key" };

  const results = await Promise.all([
    call("/api/federation/mail", { method: "POST", body, token }),
    call("/api/federation/mail", { method: "POST", body, token }),
  ]);

  assert.equal(results.every((result) => result.status === 200), true);
  assert.equal(results.filter((result) => result.data.duplicate === true).length, 1);
  assert.equal(mailer.sent.length, 1);

  const quota = await call("/api/federation/mail", { token });
  assert.equal(quota.data.quota.used, 1);
});

test("relay api: concurrent sends cannot exceed the daily quota", async (t) => {
  const { store, call, mailer } = await start(t, {
    mailer: recordingMailer({ delayMs: 30 }),
    dailyLimit: 2,
  });
  const token = issue(store);

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      call("/api/federation/mail", {
        method: "POST",
        body: { ...message, idempotencyKey: `quota-${index}` },
        token,
      })
    )
  );

  assert.equal(results.filter((result) => result.status === 200).length, 2);
  assert.equal(results.filter((result) => result.status === 429).length, 3);
  assert.equal(mailer.sent.length, 2);
  assert.equal((await call("/api/federation/mail", { token })).data.quota.used, 2);
});

test("relay api: the daily quota is enforced", async (t) => {
  const { store, call, mailer } = await start(t, { dailyLimit: 2 });
  const token = issue(store);
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);
  const blocked = await call("/api/federation/mail", { method: "POST", body: message, token });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, "quota_exceeded");
  assert.equal(mailer.sent.length, 2);
});

test("relay api: an SMTP failure is reported and logged without the body", async (t) => {
  t.mock.method(console, "error", () => {});
  const failing = recordingMailer({ fail: true });
  const { store, call } = await start(t, { mailer: failing });
  const token = issue(store);
  const result = await call("/api/federation/mail", { method: "POST", body: message, token });

  assert.equal(result.status, 502);
  assert.equal(result.data.error, "smtp_failed");
  // 没有应答数字码的失败不该被当成瞬时的：这类多半是配置或认证问题。
  assert.equal(result.data.transient, undefined);
  assert.equal(result.headers.get("retry-after"), null);
  const log = store.listRelayLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].status, "failed");
  assert.equal(log[0].error, "smtp_command");
  assert.equal(log[0].toDomain, "example.com");
  assert.ok(!JSON.stringify(log).includes("验证你的邮箱"));
});

// 收信端回 4xx 时，实例必须知道「等多久再来」；不给这一项，它会立刻用同一个
// 幂等键撞回来，正好把流控续上。
test("relay api: a 4xx answer carries the smtp code and a retry-after", async (t) => {
  t.mock.method(console, "error", () => {});
  const throttled = {
    from: "notify@mail.xknot.si",
    async send() {
      const error = new Error("smtp_data_421");
      error.code = "smtp_data";
      error.responseCode = 421;
      error.enhancedStatus = "4.7.28";
      error.transient = true;
      error.replyText = "4.7.28 review our Bulk Email Senders Guidelines - gsmtp";
      throw error;
    },
  };
  const { store, call } = await start(t, { mailer: throttled });
  const token = issue(store);
  const result = await call("/api/federation/mail", { method: "POST", body: message, token });

  assert.equal(result.status, 502);
  assert.equal(result.data.error, "smtp_failed");
  assert.equal(result.data.transient, true);
  assert.equal(result.data.smtp, "421 4.7.28");
  assert.equal(result.headers.get("retry-after"), "300");
  // 记的是码不是原话：原话里可能有地址，而这张表只存域名与哈希。
  assert.equal(store.listRelayLog()[0].error, "421 4.7.28");
});

test("relay api: disabled relay answers 503", async (t) => {
  const { store, call } = await start(t, { enabled: false });
  const token = issue(store);
  const result = await call("/api/federation/mail", { method: "POST", body: message, token });
  assert.equal(result.status, 503);
  assert.equal(result.data.error, "relay_unavailable");
});

// 每实例开关：关掉只影响这一个节点，恢复后同一个凭据立刻又能用。
const LISTED = [{ ...instance, url: "https://nordhavn.xknot.si", status: "active" }];

test("relay api: a switched-off instance gets 403 relay_disabled and recovers as-is", async (t) => {
  const { store, call } = await start(t, { instances: LISTED });
  const token = issue(store);

  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);

  store.setRelaySwitch("nordhavn", { disabled: true, note: "退信率升高" });
  const blocked = await call("/api/federation/mail", { method: "POST", body: message, token });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error, "relay_disabled");
  // 查额度也一并拒绝：实例从状态码就能判断「等一等还有没有意义」。
  assert.equal((await call("/api/federation/mail", { token })).status, 403);

  store.setRelaySwitch("nordhavn", { disabled: false });
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);
});

test("relay api: the console mail switch pauses delegated mail and restores it as-is", async (t) => {
  const { store, call, mailer } = await start(t, { instances: LISTED });
  const token = issue(store);

  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);

  // 控制台那一行（/admin 的发信总闸）关掉：与「环境变量没开」同一个 503，
  // 端侧据此判断「这次不是我的问题，等中枢」。
  store.setSetting("mail", "off", "paul");
  const blocked = await call("/api/federation/mail", { method: "POST", body: message, token });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.error, "relay_unavailable");
  // 查额度同样 503：这时候说「还有 49 封额度」是误导。
  assert.equal((await call("/api/federation/mail", { token })).status, 503);
  assert.equal(mailer.sent.length, 1, "停发期间一封都不能出去");

  // 打开即恢复：凭据、额度、日志都不动。
  store.setSetting("mail", "on", "paul");
  assert.equal((await call("/api/federation/mail", { method: "POST", body: message, token })).status, 200);
  assert.equal(mailer.sent.length, 2);
});

test("relay api: the hub-wide switch still answers 503, distinct from a per-instance pause", async (t) => {
  const { store, call } = await start(t, { enabled: false, instances: LISTED });
  const token = issue(store);
  store.setRelaySwitch("nordhavn", { disabled: true });
  const result = await call("/api/federation/mail", { method: "POST", body: message, token });
  assert.equal(result.status, 503);
  assert.equal(result.data.error, "relay_unavailable");
});

test("relay api: the case key cannot mint credentials any more", async (t) => {
  const { store, call } = await start(t, { instances: LISTED });
  const application = store.createApplication({
    name: "nordhavn",
    subdomain: "nordhavn",
    operator: "Ops",
    email: "ops@nordhavn.example",
    region: "SE",
    timezone: "Europe/Stockholm",
    intro: "自用实例。",
  });
  // 自取端点已撤掉：案例键只剩交公钥、读进度、撤回三件事。
  // 落不到任何签发逻辑上，也就不可能绕开运营方拿到凭据。
  const result = await call(`/api/case/${application.caseKey}/relay`, { method: "POST" });
  assert.notEqual(result.status, 200);
  assert.equal(store.listRelayTokens().length, 0);
});
