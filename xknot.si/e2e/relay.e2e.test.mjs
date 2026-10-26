// 委托发信的端到端测试：真实 HTTP + 真实 SMTP 会话 + 真实 CLI 签发。
//
// 收信端是 e2e/smtp-sink.mjs，不是 recording mailer：这样 server/mail.mjs
// 的 EHLO → MAIL FROM → RCPT TO → DATA 与 store 的额度、幂等、日志一起被覆盖。
//
// 跑法：npm run test:e2e

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startSmtpSink } from "./smtp-sink.mjs";
import { DEFAULT_MANIFEST, startStack } from "../ops/local-stack.mjs";

const MAIL_FROM = "notify@mail.xknot.si";

let sink;
let stack;
let mainToken;

before(async () => {
  sink = await startSmtpSink();
  stack = await startStack({
    manifest: DEFAULT_MANIFEST,
    env: {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(sink.port),
      SMTP_SECURE: "0",
      SMTP_ALLOW_INSECURE: "1",
      MAIL_FROM,
      XKNOT_ADMIN_EMAIL: "admin@e2e.example",
    },
  });
  mainToken = await stack.issueRelayToken("e2e-node", ["--daily", "20"]);
});

after(async () => {
  await stack?.stop();
  await sink?.close();
});

async function relay({ method = "POST", body, token = mainToken } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${stack.portalUrl}/api/federation/mail`, {
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

const message = {
  to: "reader@example.org",
  subject: "一条委托通知",
  text: "这是实例请中枢代发的通知。",
};

test("relay: 用运维命令签发的凭据能发信，收件方看到中枢发件人与实例回信地址", async () => {
  const result = await relay({ body: message });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.ok, true);
  assert.equal(result.data.delivery.toDomain, "example.org");

  const delivered = sink.messages.at(-1);
  assert.ok(delivered, "sink 应该收到一封信");
  assert.equal(delivered.envelopeFrom, MAIL_FROM);
  assert.deepEqual(delivered.envelopeTo, ["reader@example.org"]);
  assert.match(delivered.from, new RegExp(MAIL_FROM));
  assert.equal(delivered.replyTo, "ops@e2e-node.example", "省略 replyTo 时用实例的 contact");
  assert.equal(delivered.subject, "一条委托通知");
  assert.equal(delivered.body.trim(), "这是实例请中枢代发的通知。");
  assert.equal(delivered.headers["x-xknot-instance"], "e2e-node");
});

test("relay: GET 查得到 24 小时额度", async () => {
  const result = await relay({ method: "GET" });
  assert.equal(result.status, 200);
  assert.equal(result.data.instance, "e2e-node");
  assert.equal(result.data.quota.windowHours, 24);
  assert.equal(result.data.quota.limit, 20);
  assert.ok(result.data.quota.used >= 1);
  assert.equal(result.data.quota.remaining, result.data.quota.limit - result.data.quota.used);
});

test("relay: 同一幂等键重试不重复发信", async () => {
  const before = sink.messages.length;
  const keyed = { ...message, idempotencyKey: "e2e-idem-1" };
  const first = await relay({ body: keyed });
  assert.equal(first.status, 200);
  assert.equal(sink.messages.length, before + 1);

  const second = await relay({ body: keyed });
  assert.equal(second.status, 200);
  assert.equal(second.data.duplicate, true);
  assert.equal(sink.messages.length, before + 1, "同键第二次不能再寄一封");
});

test("relay: 字段非法按字段拒绝", async () => {
  // 单独一份凭据：限流在字段校验之前计数，共用凭据会先撞到每分钟 6 封。
  const token = await stack.issueRelayToken("e2e-node");
  const displayName = await relay({
    body: { ...message, to: "Reader <reader@example.org>" },
    token,
  });
  assert.equal(displayName.status, 400);
  assert.equal(displayName.data.fields.to, "invalid_address");

  const newline = await relay({ body: { ...message, subject: "a\r\nBcc: x@example.org" }, token });
  assert.equal(newline.status, 400);
  assert.equal(newline.data.fields.subject, "newline");

  const foreign = await relay({ body: { ...message, replyTo: "someone@evil.example" }, token });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.data.fields.replyTo, "foreign_domain");

  // 放行的是实例自己签发的域名，不是联系邮箱所在的那个域：
  // 按域名放行联系邮箱的域，等于允许把回复指向该域下别人的信箱。
  const ownDomain = await relay({ body: { ...message, replyTo: "desk@e2e-node.xknot.si" }, token });
  assert.equal(ownDomain.status, 200, "实例自己签发域名下的回信地址应放行");

  const siblingMailbox = await relay({ body: { ...message, replyTo: "desk@e2e-node.example" }, token });
  assert.equal(siblingMailbox.status, 400);
  assert.equal(siblingMailbox.data.fields.replyTo, "foreign_domain");
});

test("relay: 没凭据、伪造凭据都是 401", async () => {
  const missing = await relay({ body: message, token: null });
  assert.equal(missing.status, 401);
  assert.equal(missing.data.error, "missing_token");

  const forged = await relay({ body: message, token: "xkr_e2e-node_forged-token-value" });
  assert.equal(forged.status, 401);
  assert.equal(forged.data.error, "invalid_token");
});

test("relay: 实例被暂停后立刻 403，不用重启接口", async () => {
  const paused = structuredClone(DEFAULT_MANIFEST);
  paused.updatedAt = "2026-01-02";
  paused.instances.find((item) => item.id === "e2e-node").status = "suspended";
  await stack.setManifest(paused);

  const result = await relay({ body: message });
  assert.equal(result.status, 403);
  assert.equal(result.data.error, "instance_inactive");

  // 恢复，后续用例还要用。
  await stack.setManifest(DEFAULT_MANIFEST);
});

test("relay: 每日额度用完返回 429", async () => {
  const token = await stack.issueRelayToken("e2e-node", ["--daily", "1"]);
  const first = await relay({ body: message, token });
  assert.equal(first.status, 200);

  const second = await relay({ body: message, token });
  assert.equal(second.status, 429);
  assert.equal(second.data.error, "quota_exceeded");
  assert.equal(second.data.quota.remaining, 0);
});

test("relay: 单凭据每分钟第 7 封开始 429", async () => {
  const token = await stack.issueRelayToken("e2e-node");
  const statuses = [];
  for (let index = 1; index <= 7; index += 1) {
    const result = await relay({ body: message, token });
    statuses.push(result.status);
  }
  assert.deepEqual(statuses.slice(0, 6), Array(6).fill(200));
  assert.equal(statuses[6], 429);
});

test("relay: 吊销后 401 token_revoked", async () => {
  const token = await stack.issueRelayToken("e2e-node");
  assert.equal((await relay({ body: message, token })).status, 200);
  const output = await stack.adminCli(["relay-revoke", "e2e-node"]);
  assert.match(output, /已吊销/);
  const result = await relay({ body: message, token });
  assert.equal(result.status, 401);
  assert.equal(result.data.error, "token_revoked");
});

test("relay: SMTP 不可用时 502，日志记 failed 且不含正文", async () => {
  const token = await stack.issueRelayToken("e2e-node");
  await sink.close();

  const result = await relay({
    body: { ...message, text: "这段正文不应出现在 relay-log 里" },
    token,
  });
  assert.equal(result.status, 502);
  assert.equal(result.data.error, "smtp_failed");

  const log = await stack.adminCli(["relay-log", "5"]);
  assert.match(log, /failed/);
  assert.ok(!log.includes("这段正文不应出现在"), "日志只留域名与哈希，不留正文");
  assert.ok(!log.includes("reader@example.org"), "日志不留完整收件地址");
});
