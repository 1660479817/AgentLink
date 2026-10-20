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
  canonical: "https://nordhavn.example",
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
  const log = store.listRelayLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].status, "failed");
  assert.equal(log[0].toDomain, "example.com");
  assert.ok(!JSON.stringify(log).includes("验证你的邮箱"));
});

test("relay api: disabled relay answers 503", async (t) => {
  const { store, call } = await start(t, { enabled: false });
  const token = issue(store);
  const result = await call("/api/federation/mail", { method: "POST", body: message, token });
  assert.equal(result.status, 503);
  assert.equal(result.data.error, "relay_unavailable");
});
