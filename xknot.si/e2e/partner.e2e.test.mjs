// 伙伴接入的端到端测试：真实 HTTP + 真实 SMTP 会话 + 真实令牌。
//
// 覆盖线上的完整路径：提交申请 → 收到验证信 → 验证页（GET 不消费、POST 才确认）
// → 案例页补发 → 审核通过 → 交接发一次性领取链接 → 领取页面（GET 不消费）→ 领取。
// 收信端是 e2e/smtp-sink.mjs，所以令牌确实是从邮件正文里取出来的，
// 不靠读库、也不靠测试后门。
//
// 跑法：npm run test:e2e

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { startSmtpSink } from "./smtp-sink.mjs";
import { DEFAULT_MANIFEST, startStack } from "../ops/local-stack.mjs";

const MAIL_FROM = "notify@mail.xknot.si";
const PASSWORD = "e2e-partner-horse-battery";
const ADMIN = "e2e-partner-admin";

const APPLICATION = {
  name: "Partners E2E",
  subdomain: "partner-e2e",
  requestAccess: "direct",
  operator: "Lin",
  email: "partner@partner-e2e.example",
  region: "NO",
  timezone: "Europe/Oslo",
  intro: "End-to-end application for the partner onboarding flow.",
  tags: "longform, testing",
  agree: true,
  locale: "en",
};

const PAYLOAD = "XKNOT_HUB_RELAY_TOKEN=xkr_e2e_partner_secret";

let sink;
let stack;
let adminCookie;

before(async () => {
  sink = await startSmtpSink();
  stack = await startStack({
    manifest: DEFAULT_MANIFEST,
    admin: { username: ADMIN, password: PASSWORD },
    env: {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(sink.port),
      SMTP_SECURE: "0",
      SMTP_ALLOW_INSECURE: "1",
      MAIL_FROM,
      XKNOT_MAIL_REPLY_TO: "no-reply@xknot.si",
      XKNOT_ADMIN_EMAIL: "admin@e2e.example",
    },
  });
});

after(async () => {
  await stack?.stop();
  await sink?.close();
});

async function request(pathname, { method = "GET", body, form, cookie, headers = {}, redirect = "manual" } = {}) {
  const merged = { accept: "text/html,application/json", ...headers };
  let payload;
  if (form !== undefined) {
    merged["content-type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    merged["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (cookie) merged.cookie = cookie;
  const response = await fetch(stack.portalUrl + pathname, {
    method,
    headers: merged,
    redirect,
    body: payload,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, text, data, headers: response.headers };
}

async function login() {
  const result = await request("/api/admin/login", {
    method: "POST",
    body: { username: ADMIN, password: PASSWORD },
    headers: { origin: stack.portalUrl },
  });
  assert.equal(result.status, 200);
  return (result.headers.getSetCookie?.() || [])[0]?.split(";")[0];
}

/** 从现在起等一封发给某地址的新信；不等旧信，避免断言串到上一封。 */
async function nextMail(to, { timeoutMs = 5000 } = {}) {
  const seen = sink.messages.filter((mail) => mail.to.includes(to)).length;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = sink.messages.filter((mail) => mail.to.includes(to));
    if (matches.length > seen) return matches.at(-1);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`no new mail for ${to}`);
}

function matchPath(text, prefix, extra = "") {
  const pattern = new RegExp(`https?:\\/\\/[^\\s"'<>]+${prefix}[A-Za-z0-9_-]{6,}${extra}`, "g");
  const found = String(text).match(pattern);
  assert.ok(found?.length, `mail should contain a ${prefix} link:\n${text}`);
  return found.at(-1).replace(/^https?:\/\/[^/]+/, "");
}

test("join: 提交后收到验证信，发件人与回信地址固定", async () => {
  const submitted = await request("/api/applications", {
    method: "POST",
    body: APPLICATION,
    headers: { origin: stack.portalUrl },
  });
  assert.equal(submitted.status, 201, submitted.text);
  const application = submitted.data.application;
  assert.equal(application.status, "pending");
  assert.match(application.id, /^XK-\d{4}-[0-9A-Z]{6}$/);

  const mail = await nextMail(APPLICATION.email);
  assert.match(mail.from, new RegExp(MAIL_FROM));
  assert.equal(mail.replyTo, "no-reply@xknot.si", "伙伴邮件不接收回复");
  assert.match(mail.body, /本邮件由系统发出，不接收回复。|This message was sent automatically; replies are not monitored\./);
  assert.ok(!/xkr_[A-Za-z0-9]/.test(mail.body), "邮件里不能出现明文凭据");

  const verifyPath = matchPath(mail.body, "/verify/");
  const casePath = matchPath(mail.body, "/case/");

  // GET 只是页面：邮件网关/安全网关预取也不该把令牌用掉。
  for (let i = 0; i < 2; i += 1) {
    const page = await request(verifyPath);
    assert.equal(page.status, 200);
    assert.match(page.text, /确认|Confirm/i);
    assert.match(page.headers.get("cache-control") || "", /no-store/);
    assert.match(page.headers.get("referrer-policy") || "", /no-referrer/);
  }

  const casePage = await request(casePath);
  assert.equal(casePage.status, 200);
  assert.ok(casePage.text.includes(APPLICATION.name));
  assert.match(casePage.text, /waiting for email confirmation|待确认/i);

  const token = verifyPath.split("/").pop();
  const confirmed = await request("/api/verify", { method: "POST", form: { token } });
  assert.equal(confirmed.status, 200);
  assert.match(confirmed.text, /confirmed|已确认/i);

  const reused = await request("/api/verify", { method: "POST", form: { token } });
  assert.equal(reused.status, 200);
  assert.match(reused.text, /already|已经/i, "同一个令牌第二次只提示已使用");

  adminCookie = await login();
  const listed = await request("/api/admin/applications?status=verified", { cookie: adminCookie });
  assert.equal(listed.status, 200);
  assert.ok(listed.data.applications.some((row) => row.id === application.id));
});

test("join: 案例页可以补发验证信，撤销后不再接受审核", async () => {
  // 用一张新的申请：上一条已经确认过邮箱，已结案的申请不再补发确认信。
  const application = {
    ...APPLICATION,
    subdomain: "partner-resend",
    email: "resend@partner-e2e.example",
  };
  const submitted = await request("/api/applications", {
    method: "POST",
    body: application,
    headers: { origin: stack.portalUrl },
  });
  assert.equal(submitted.status, 201, submitted.text);

  const received = await nextMail(application.email);
  const casePath = matchPath(received.body, "/case/");

  const resent = await request(`/api${casePath}/resend-verify`, { method: "POST" });
  assert.equal(resent.status, 303);
  assert.match(resent.headers.get("location") || "", /resend=1/);

  const resentMail = await nextMail(application.email);
  assert.ok(matchPath(resentMail.body, "/verify/"));
  assert.ok(matchPath(resentMail.body, "/case/"));

  const withdrawn = await request(`/api${casePath}/withdraw`, { method: "POST" });
  assert.equal(withdrawn.status, 303);
  assert.match(withdrawn.headers.get("location") || "", /withdrawn=1/);

  const page = await request(casePath);
  assert.equal(page.status, 200);
  assert.match(page.text, /withdrawn|已撤回/i);
});

test("join: 审核通过后交接发一次性领取链接，领取页不消费、领取只能用一次", async () => {
  // 上一条测试把申请撤回（结案）了，这里重新走一条完整链路。
  const application = {
    ...APPLICATION,
    subdomain: "partner-claim",
    requestAccess: "tunnel",
    email: "claim@partner-e2e.example",
  };
  const submitted = await request("/api/applications", {
    method: "POST",
    body: application,
    headers: { origin: stack.portalUrl },
  });
  assert.equal(submitted.status, 201, submitted.text);
  const id = submitted.data.application.id;

  const received = await nextMail(application.email);
  const token = matchPath(received.body, "/verify/").split("/").pop();
  assert.equal((await request("/api/verify", { method: "POST", form: { token } })).status, 200);

  const approved = await request(`/api/admin/applications/${id}/review`, {
    method: "POST",
    cookie: adminCookie,
    headers: { origin: stack.portalUrl },
    body: { decision: "approve" },
  });
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.data.application.status, "approved");

  const handoff = await request(`/api/admin/applications/${id}/handoff`, {
    method: "POST",
    cookie: adminCookie,
    headers: { origin: stack.portalUrl },
    body: { payload: PAYLOAD, ttlHours: 72 },
  });
  assert.equal(handoff.status, 200, handoff.text);
  const claimPath = handoff.data.claimUrl.replace(/^https?:\/\/[^/]+/, "");

  const handedOff = await nextMail(application.email);
  assert.ok(!handedOff.body.includes(PAYLOAD), "交接信里不能有明文凭据");

  // 领取页同样只渲染，不消费。
  for (let i = 0; i < 2; i += 1) {
    const page = await request(claimPath);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("cache-control") || "", /no-store/);
  }

  const claimToken = claimPath.split("/").pop();
  const claimed = await request("/api/claim", { method: "POST", form: { token: claimToken } });
  assert.equal(claimed.status, 200);
  assert.ok(claimed.text.includes(PAYLOAD), "第一次领取要给出交接内容");

  const second = await request("/api/claim", { method: "POST", form: { token: claimToken } });
  assert.equal(second.status, 409);
  assert.ok(!second.text.includes(PAYLOAD), "第二次领取不能再泄露内容");

  const manifest = await request(`/api/admin/applications/${id}/manifest`, { cookie: adminCookie });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.data.entry.status, "active");
  assert.equal(manifest.data.entry.url, `https://${application.subdomain}.xknot.si`);
  assert.equal(manifest.data.entry.id, application.subdomain, "the subdomain label is the id");
});
