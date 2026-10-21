import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createApp } from "./app.mjs";
import { checkManifestEntry, suggestId, toManifestEntry } from "./manifest.mjs";
import { openMemoryStore } from "./store.mjs";
import { normalizeSubdomain, normalizeTags, validateApplication } from "./validate.mjs";

const valid = {
  name: "北港",
  mode: "subdomain",
  subdomain: "nordhavn",
  operator: "Lin",
  email: "lin@example.com",
  region: "NO",
  timezone: "Europe/Oslo",
  intro: "北海沿岸的慢阅读与长文笔记。",
  tags: "长文, 设计",
  agree: true,
};

async function start(t, options = {}) {
  const store = openMemoryStore();
  const { handle } = createApp({
    store,
    config: {
      secret: "test",
      adminDir: null,
      mailer: options.mailer || null,
      adminEmail: options.adminEmail || "",
      origin: options.origin || "https://xknot.si",
      replyTo: options.replyTo || "",
      supportUrl: options.supportUrl || "",
      instances: options.instances || [],
      instancesProvider: () => options.instances || [],
      federationProvider: () => options.federation || null,
      healthProvider: () => options.health || null,
      instancesFile: options.instancesFile || null,
      federationFile: options.federationFile || null,
      profilesDir: options.profilesDir || null,
      statsDir: options.statsDir || null,
      cardsDir: options.cardsDir || null,
    },
  });
  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      res.writeHead(500).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    store.close();
  });

  async function call(path, { method = "GET", body, form, cookie, origin } = {}) {
    const headers = { accept: "application/json" };
    const payload = form !== undefined ? new URLSearchParams(form).toString() : body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) {
      headers["content-type"] =
        form !== undefined ? "application/x-www-form-urlencoded" : "application/json";
    }
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    const response = await fetch(base + path, {
      method,
      headers,
      body: payload,
      redirect: "manual",
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

  // 走一遍真实的邮箱确认：令牌从 store 取，POST 到 /api/verify。
  async function verify(application) {
    const issued = store.issueVerifyToken({ applicationId: application.id });
    assert.ok(issued.token, "verify token should be issued");
    const result = await call("/api/verify", { method: "POST", form: { token: issued.token } });
    assert.equal(result.status, 200);
    return result;
  }

  return { store, call, base, verify };
}

function adminCookie(result) {
  const raw = result.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

async function loginAs(call, store, username = "paul", password = "correct-horse-battery") {
  store.createAdmin({ username, password });
  const login = await call("/api/admin/login", { method: "POST", body: { username, password } });
  return adminCookie(login);
}

test("validate: a complete application passes and is normalized", () => {
  const result = validateApplication(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.mode, "subdomain");
  assert.equal(result.value.subdomain, "nordhavn");
  assert.equal(result.value.domain, null);
  assert.equal(result.value.url, "https://nordhavn.xknot.si");
  assert.deepEqual(result.value.tags, ["长文", "设计"]);
  assert.equal(result.value.email, "lin@example.com");
});

test("validate: missing and malformed fields report per-field codes", () => {
  const noMode = validateApplication({ ...valid, mode: "" });
  assert.equal(noMode.ok, false);
  assert.equal(noMode.errors.mode, "required");

  const result = validateApplication({ ...valid, mode: "subdomain", subdomain: "nord havn", email: "lin@", agree: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors.subdomain, "invalid");
  assert.equal(result.errors.email, "invalid_email");
  assert.equal(result.errors.agree, "required");
});

test("validate: own domain is the address, xknot.si subdomains are not", () => {
  const own = validateApplication({ ...valid, mode: "own-domain", domain: "https://Example.COM/" });
  assert.equal(own.ok, true);
  assert.equal(own.value.domain, "https://example.com");
  assert.equal(own.value.subdomain, null);
  assert.equal(own.value.url, "https://example.com");

  assert.equal(validateApplication({ ...valid, mode: "own-domain", domain: "" }).errors.domain, "invalid");
  assert.equal(validateApplication({ ...valid, mode: "own-domain", domain: "http://example.com" }).errors.domain, "invalid");
  assert.equal(validateApplication({ ...valid, mode: "own-domain", domain: "travel.xknot.si" }).errors.domain, "invalid");
  assert.equal(validateApplication({ ...valid, mode: "own-domain", domain: "192.168.3.91" }).errors.domain, "invalid");
  assert.equal(validateApplication({ ...valid, mode: "own-domain", domain: "user:pass@example.com" }).errors.domain, "invalid");
  // 自有域名模式不看子域字段，反之亦然。
  assert.equal(validateApplication({ ...valid, mode: "own-domain", domain: "example.com", subdomain: "www" }).ok, true);
});

test("validate: the subdomain label is the identity, not a full URL", () => {
  assert.equal(validateApplication({ ...valid, subdomain: "https://travel.xknot.si/" }).value.subdomain, "travel");
  assert.equal(validateApplication({ ...valid, subdomain: "Travel" }).value.subdomain, "travel");
  assert.equal(validateApplication({ ...valid, subdomain: "https://nordhavn.example" }).errors.subdomain, "invalid");
  assert.equal(validateApplication({ ...valid, subdomain: "a" }).errors.subdomain, "invalid");
  assert.equal(validateApplication({ ...valid, subdomain: "www" }).errors.subdomain, "reserved");
  assert.equal(validateApplication({ ...valid, subdomain: "admin" }).errors.subdomain, "reserved");
  assert.equal(validateApplication({ ...valid, subdomain: "-x" }).errors.subdomain, "invalid");
  assert.equal(validateApplication({ ...valid, subdomain: "x-" }).errors.subdomain, "invalid");
  assert.equal(validateApplication({ ...valid, subdomain: "x".repeat(33) }).errors.subdomain, "invalid");
  // 模式只接受两种明确选择。
  assert.equal(validateApplication({ ...valid, mode: "vpn" }).errors.mode, "required");
  assert.equal(validateApplication({ ...valid, mode: "own-domain" }).errors.domain, "invalid");
});

test("validate: non-https, credentials in URL and unknown regions are rejected", () => {
  assert.equal(validateApplication({ ...valid, region: "ZZ" }).errors.region, "invalid_region");
  assert.equal(validateApplication({ ...valid, region: "GLOBAL" }).ok, true);
  assert.equal(validateApplication({ ...valid, timezone: "Mars/Base" }).errors.timezone, "invalid_timezone");
});

test("validate: over-long text is rejected instead of silently cut", () => {
  const longName = "名".repeat(41);
  assert.equal(validateApplication({ ...valid, name: longName }).errors.name, "too_long");
  assert.equal(validateApplication({ ...valid, intro: "长".repeat(61) }).errors.intro, "too_long");
  assert.equal(validateApplication({ ...valid, tags: "a,b,c,d,e,f" }).errors.tags, "too_many_tags");
});

test("normalize: tags split on both comma styles and drop duplicates", () => {
  assert.deepEqual(normalizeTags("Agent，工具 chain, agent"), ["Agent", "工具", "chain"]);
  assert.equal(normalizeSubdomain("https://travel.xknot.si/"), "travel");
  assert.equal(normalizeSubdomain("travel.xknot.si"), "travel");
  assert.equal(normalizeSubdomain("travel"), "travel");
  assert.equal(normalizeSubdomain("BAD_Label"), "");
});

test("api: health advertises the documented service shape", async (t) => {
  const { call } = await start(t);
  const result = await call("/api/health");
  assert.equal(result.status, 200);
  assert.equal(result.data.ok, true);
  assert.equal(result.data.service, "xknot-hub");
  assert.equal(typeof result.data.version, "string");
  assert.match(result.data.at, /^\d{4}-\d{2}-\d{2}T/);
});

test("api: submission returns an id and lands in the pending queue", async (t) => {
  const { call, store } = await start(t);
  const result = await call("/api/applications", { method: "POST", body: { ...valid, locale: "zh-CN" } });
  assert.equal(result.status, 201);
  assert.match(result.data.application.id, /^XK-\d{4}-[0-9A-Z]{6}$/);
  assert.equal(result.data.application.status, "pending");
  assert.equal(store.listApplications({ status: "pending" }).length, 1);
});

function recordingMailer() {
  const sent = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

test("api: a new application emails the applicant and the admin", async (t) => {
  const mailer = recordingMailer();
  const { call } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const result = await call("/api/applications", {
    method: "POST",
    body: { ...valid, locale: "en" },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(mailer.sent.length, 2);
  const [partner, admin] = mailer.sent;
  assert.equal(partner.to, "lin@example.com");
  assert.match(partner.subject, /application received/);
  assert.equal(partner.replyTo, "", "partner mail must not accept replies");
  assert.match(partner.text, /replies are not monitored/);
  assert.match(partner.text, /\/verify\//);
  assert.match(partner.text, new RegExp(result.data.application.id));

  assert.equal(admin.to, "admin@example.com");
  assert.equal(admin.replyTo, "lin@example.com");
  assert.match(admin.subject, /new application/);
  assert.match(admin.text, /https:\/\/xknot\.si\/admin\//);
});

test("api: a broken mailer never fails the submission", async (t) => {
  t.mock.method(console, "error", () => {});
  const mailer = {
    async send() {
      throw new Error("smtp_down");
    },
  };
  const { call, store } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const result = await call("/api/applications", { method: "POST", body: valid });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.status, 201);
  assert.equal(store.listApplications({ status: "pending" }).length, 1);
});

test("api: approval, rejection and hold email the applicant after verification", async (t) => {
  const mailer = recordingMailer();
  const { call, verify, store } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const cookie = await loginAs(call, store);

  const approved = await call("/api/applications", {
    method: "POST",
    body: { ...valid, locale: "zh-CN" },
  });
  await verify(approved.data.application);
  const approvedReview = await call(`/api/admin/applications/${approved.data.application.id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "approve" },
  });
  assert.equal(approvedReview.status, 200);
  assert.equal(approvedReview.data.application.status, "approved");

  const rejected = await call("/api/applications", {
    method: "POST",
    body: { ...valid, subdomain: "sakura", locale: "en" },
  });
  await verify(rejected.data.application);
  await call(`/api/admin/applications/${rejected.data.application.id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "reject", note: "内部备注，不该出现在信里", reason: "policy" },
  });

  const held = await call("/api/applications", {
    method: "POST",
    body: { ...valid, subdomain: "hold", locale: "zh-CN" },
  });
  await verify(held.data.application);
  await call(`/api/admin/applications/${held.data.application.id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "hold", items: ["site_unreachable", "health_missing"] },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const applicantMail = mailer.sent.filter((mail) => mail.to === "lin@example.com");
  // received ×3 + verified ×3 + approved + rejected + hold
  assert.equal(applicantMail.length, 9);
  const approvedMail = applicantMail.find((mail) => /已通过收录审核/.test(mail.subject));
  const rejectedMail = applicantMail.find((mail) => /result for|审核结果/.test(mail.subject));
  const holdMail = applicantMail.find((mail) => /需要补充材料/.test(mail.subject));
  assert.ok(approvedMail && rejectedMail && holdMail, applicantMail.map((mail) => mail.subject).join(" | "));
  assert.equal(approvedMail.replyTo, "");
  assert.ok(!rejectedMail.text.includes("内部备注"));
  assert.match(rejectedMail.text, /does not fit the federation terms|不符合联邦约定/);
  assert.match(holdMail.text, /站点地址从公网打不开/);
  assert.match(holdMail.text, /\/case\//);
});

test("api: the same site cannot be queued twice", async (t) => {
  const { call } = await start(t);
  assert.equal((await call("/api/applications", { method: "POST", body: valid })).status, 201);
  const again = await call("/api/applications", { method: "POST", body: { ...valid, name: "另一个名字" } });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, "duplicate");
});

test("api: validation errors come back as field codes", async (t) => {
  const { call } = await start(t);
  const result = await call("/api/applications", { method: "POST", body: { ...valid, email: "nope" } });
  assert.equal(result.status, 400);
  assert.equal(result.data.error, "invalid");
  assert.equal(result.data.fields.email, "invalid_email");
});

test("api: a filled honeypot is accepted but never stored", async (t) => {
  const { call, store } = await start(t);
  const result = await call("/api/applications", {
    method: "POST",
    body: { ...valid, website: "http://spam.example" },
  });
  assert.equal(result.status, 201);
  assert.equal(store.listApplications().length, 0);
});

test("api: cross-origin posts are refused", async (t) => {
  const { call } = await start(t);
  const result = await call("/api/applications", {
    method: "POST",
    body: valid,
    origin: "https://evil.example",
  });
  assert.equal(result.status, 403);
});

test("api: repeated submissions from one address are rate limited", async (t) => {
  const { call } = await start(t);
  let last = null;
  for (let index = 0; index < 10; index += 1) {
    last = await call("/api/applications", {
      method: "POST",
      body: { ...valid, subdomain: `site${index}` },
    });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});

test("api: admin endpoints require a session", async (t) => {
  const { call } = await start(t);
  assert.equal((await call("/api/admin/applications")).status, 401);
  assert.equal((await call("/api/admin/overview")).status, 401);
  assert.equal((await call("/api/admin/session")).status, 401);
});

test("api: wrong password and unknown user are both rejected", async (t) => {
  const { call, store } = await start(t);
  store.createAdmin({ username: "paul", password: "correct-horse-battery" });
  assert.equal((await call("/api/admin/login", { method: "POST", body: { username: "paul", password: "nope" } })).status, 401);
  assert.equal((await call("/api/admin/login", { method: "POST", body: { username: "ghost", password: "nope" } })).status, 401);
});

test("api: an admin reviews an application and gets a valid manifest entry", async (t) => {
  const { call, store, verify } = await start(t);
  const cookie = await loginAs(call, store);

  const submitted = await call("/api/applications", { method: "POST", body: valid });
  const id = submitted.data.application.id;

  const listed = await call("/api/admin/applications?status=pending", { cookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.applications.length, 1);
  assert.equal(listed.data.counts.pending, 1);

  // 未经邮箱确认不能直接通过：pending 只能走 verified。
  const tooEarly = await call(`/api/admin/applications/${id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "approve" },
  });
  assert.equal(tooEarly.status, 409);
  assert.equal(tooEarly.data.error, "invalid_transition");

  await verify(submitted.data.application);
  assert.equal(store.getApplication(id).status, "verified");

  const reviewed = await call(`/api/admin/applications/${id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "approve", note: "域名核对过" },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.data.application.status, "approved");
  assert.equal(reviewed.data.application.reviewedBy, "paul");

  const manifest = await call(`/api/admin/applications/${id}/manifest`, { cookie });
  assert.equal(manifest.status, 200);
  const entry = manifest.data.entry;
  assert.equal(entry.url, "https://nordhavn.xknot.si");
  assert.equal(entry.id, "nordhavn");
  assert.equal(entry.tier, "community");
  assert.equal(entry.status, "pending");
  // 名称、介绍由主理人在实例侧写，中枢不再从申请里抄一份。
  assert.equal(entry.name, undefined);
  assert.equal(entry.healthUrl, undefined, "no probe url in the manifest: it is derived from url");
  assert.deepEqual(checkManifestEntry(entry), []);
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/);
});

test("api: overview summarises instances, queue and mail for admins", async (t) => {
  const downAt = new Date(Date.now() - 3600_000).toISOString();
  const { call, store } = await start(t, {
    instances: [
      {
        id: "alpha",
        name: { en: "Alpha", "zh-CN": "甲站" },
        url: "https://alpha.xknot.si",
        tier: "partner",
        status: "active",
        cardsUrl: "https://alpha.xknot.si/knot-cards.json",
        statsUrl: null,
        regions: ["SG"],
      },
      {
        id: "beta",
        name: { en: "Beta", "zh-CN": "乙站" },
        url: "https://beta.xknot.si",
        tier: "community",
        status: "active",
        regions: ["CN"],
      },
    ],
    health: {
      checkedAt: downAt,
      instances: {
        alpha: { status: "down", error: "timeout", lastOkAt: downAt, downSince: downAt },
      },
    },
    federation: {
      hub: "xknot.si",
      updatedAt: "2026-10-20",
      members: [
        {
          id: "alpha",
          host: "alpha.xknot.si",
          role: "founder",
          standing: "permanent",
          mode: "subdomain",
          tunnel: { account: "knot-tunnel-alpha", port: 18080 },
          listed: true,
          since: "2026-10-19",
          note: "永久席位。",
        },
      ],
    },
  });

  const cookie = await loginAs(call, store);
  await call("/api/applications", { method: "POST", body: { ...valid, subdomain: "gamma" } });
  store.createRelayToken({ instanceId: "alpha", createdBy: "paul" });

  const result = await call("/api/admin/overview", { cookie });
  assert.equal(result.status, 200);
  const data = result.data;

  assert.equal(data.instances.total, 2);
  assert.equal(data.instances.down, 1);
  assert.equal(data.instances.unprobed, 1, "not in the roster means not connected, not down");
  assert.equal(data.instances.cards, 1);
  assert.equal(data.instances.checkedAt, downAt);
  assert.equal(data.instances.rows[0].name, "甲站");
  assert.equal(data.instances.rows[0].health.error, "timeout");
  assert.equal(data.instances.rows[1].health.status, "unprobed");

  // 点开实例要看到账号自己的配置，所以名册里的身份、隧道与清单里的入口一起返回。
  const alphaConfig = data.instances.rows[0].config;
  assert.equal(alphaConfig.account, "alpha");
  assert.equal(alphaConfig.host, "alpha.xknot.si");
  assert.equal(alphaConfig.role, "founder");
  assert.equal(alphaConfig.standing, "permanent");
  assert.equal(alphaConfig.mode, "subdomain");
  assert.deepEqual(alphaConfig.tunnel, { account: "knot-tunnel-alpha", port: 18080 });
  assert.equal(alphaConfig.listed, true);
  assert.equal(alphaConfig.probeUrl, "https://alpha.xknot.si/api/health");
  assert.equal(alphaConfig.cardsUrl, "https://alpha.xknot.si/knot-cards.json");
  assert.equal(alphaConfig.note, "永久席位。");

  // 不在名册里的实例也要能点开：身份字段给 null，地址仍然可读。
  // 探测地址由 url 推出，所以这一条也算得出来；但名册缺失，不会去探。
  const betaConfig = data.instances.rows[1].config;
  assert.equal(betaConfig.account, "beta");
  assert.equal(betaConfig.host, "beta.xknot.si");
  assert.equal(betaConfig.role, null);
  assert.equal(betaConfig.tunnel, null);
  assert.equal(betaConfig.listed, null);
  assert.equal(betaConfig.probeUrl, "https://beta.xknot.si/api/health");

  assert.equal(data.federation.hub, "xknot.si");
  assert.equal(data.federation.members, 1);

  assert.equal(data.applications.counts.pending, 1);
  assert.ok(data.applications.oldestOpenAt, "the queue age must be visible");
  assert.deepEqual(data.applications.approvedNotListed, []);
  assert.ok(data.events.some((event) => event.kind === "application.submitted"));

  assert.equal(data.mail.enabled, false);
  assert.equal(data.relay.tokens, 1);
  assert.equal(data.relay.activeTokens, 1);
  assert.equal(data.relay.accepted, 0);
  assert.equal(typeof data.runtime.uptimeSeconds, "number");
  assert.match(data.runtime.version, /^\d+\.\d+\.\d+$/);
});

test("api: overview flags approved applications that never reached the manifest", async (t) => {
  const { call, store, verify } = await start(t);
  const cookie = await loginAs(call, store);
  const submitted = await call("/api/applications", { method: "POST", body: valid });
  await verify(submitted.data.application);
  await call(`/api/admin/applications/${submitted.data.application.id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "approve" },
  });

  const result = await call("/api/admin/overview", { cookie });
  assert.equal(result.status, 200);
  assert.equal(result.data.instances.total, 0);
  assert.deepEqual(
    result.data.applications.approvedNotListed.map((item) => item.address),
    ["https://nordhavn.xknot.si"]
  );
});

test("api: logout drops the session", async (t) => {
  const { call, store } = await start(t);
  store.createAdmin({ username: "paul", password: "correct-horse-battery" });
  const login = await call("/api/admin/login", {
    method: "POST",
    body: { username: "paul", password: "correct-horse-battery" },
  });
  const cookie = adminCookie(login);
  assert.equal((await call("/api/admin/session", { cookie })).status, 200);
  await call("/api/admin/logout", { method: "POST", cookie });
  assert.equal((await call("/api/admin/session", { cookie })).status, 401);
});

test("manifest: id comes from the hostname, with a fallback", () => {
  assert.equal(suggestId("https://sakura.example.jp"), "sakura");
  assert.equal(suggestId("https://nord-havn.example"), "nord-havn");
  assert.match(suggestId("https://例子.中国"), /^node-/);
});

test("manifest: a new entry never carries a probe url", () => {
  // 探测地址由 url 推出，清单不重复存一份；探不探由清单 status 决定。
  const application = {
    name: "北港",
    subdomain: "nordhavn",
    url: "https://nordhavn.xknot.si",
    region: "NO",
    timezone: "Europe/Oslo",
    operator: "Ops",
    email: "ops@nordhavn.example",
    intro: "News from the harbour.",
    tags: [],
  };
  const entry = toManifestEntry(application);
  assert.equal(entry.healthUrl, undefined);
  assert.equal(entry.url, "https://nordhavn.xknot.si");
  assert.equal(entry.id, "nordhavn");
  assert.deepEqual(checkManifestEntry(entry), []);
});

// ---- 验证链接、案例页、一次性领取 ----

function tokenFromMail(text, kind) {
  const match = new RegExp(`/${kind}/([A-Za-z0-9_-]{8,128})`).exec(String(text || ""));
  return match ? match[1] : null;
}

test("api: the verify page never consumes the token, the POST does", async (t) => {
  const mailer = recordingMailer();
  const { call, store } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const submitted = await call("/api/applications", { method: "POST", body: { ...valid, locale: "en" } });
  await new Promise((resolve) => setImmediate(resolve));

  const token = tokenFromMail(mailer.sent[0].text, "verify");
  assert.ok(token, "the partner mail must carry a verify link");

  // 邮件安全网关会预取链接：GET 只能渲染页面。
  const page = await call(`/verify/${token}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /Confirm your email/);
  assert.equal(store.getApplication(submitted.data.application.id).status, "pending");

  const confirmed = await call("/api/verify", { method: "POST", form: { token } });
  assert.equal(confirmed.status, 200);
  assert.match(confirmed.data, /Email confirmed/);
  assert.equal(store.getApplication(submitted.data.application.id).status, "verified");

  const again = await call("/api/verify", { method: "POST", form: { token } });
  assert.equal(again.status, 200);
  assert.match(again.data, /already used/);

  const missing = await call("/api/verify", { method: "POST", form: { token: "nope-nope-nope" } });
  assert.equal(missing.status, 404);
});

test("api: verification mails the partner once per state version", async (t) => {
  const mailer = recordingMailer();
  const { call, store } = await start(t, { mailer, adminEmail: "admin@example.com" });
  await call("/api/applications", { method: "POST", body: { ...valid, locale: "zh-CN" } });
  await new Promise((resolve) => setImmediate(resolve));
  const token = tokenFromMail(mailer.sent[0].text, "verify");

  await call("/api/verify", { method: "POST", form: { token } });
  await new Promise((resolve) => setImmediate(resolve));

  const verifiedMail = mailer.sent.filter((mail) => /已进入审核/.test(mail.subject));
  assert.equal(verifiedMail.length, 1);
  const log = store.listNotifyLog(50);
  assert.ok(log.some((row) => row.event === "partner.verified" && row.status === "sent"));
  assert.ok(log.some((row) => row.event === "internal.application_verified" && row.status === "sent"));
});

test("api: the case page shows status and accepts resend and withdraw", async (t) => {
  const mailer = recordingMailer();
  const { call, store } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const submitted = await call("/api/applications", { method: "POST", body: valid });
  await new Promise((resolve) => setImmediate(resolve));

  const application = store.getApplication(submitted.data.application.id);
  const page = await call(`/case/${application.caseKey}`);
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(application.id));
  assert.match(page.data, /Resend verification message/i);

  const before = mailer.sent.length;
  const resent = await call(`/api/case/${application.caseKey}/resend-verify`, { method: "POST" });
  assert.equal(resent.status, 303);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(mailer.sent.length > before, "resend must send a new verify mail");

  const withdrawn = await call(`/api/case/${application.caseKey}/withdraw`, { method: "POST" });
  assert.equal(withdrawn.status, 303);
  assert.equal(store.getApplication(application.id).status, "withdrawn");

  const closed = await call(`/case/${application.caseKey}`);
  assert.match(closed.data, /withdrawn|撤回/i);
});

test("api: handoff issues a single-use claim link and the page does not consume it", async (t) => {
  const mailer = recordingMailer();
  const { call, store, verify } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const cookie = await loginAs(call, store);

  const submitted = await call("/api/applications", { method: "POST", body: { ...valid, locale: "zh-CN" } });
  await verify(submitted.data.application);
  const id = submitted.data.application.id;
  await call(`/api/admin/applications/${id}/review`, { method: "POST", cookie, body: { decision: "approve" } });
  await new Promise((resolve) => setImmediate(resolve));

  const handoff = await call(`/api/admin/applications/${id}/handoff`, {
    method: "POST",
    cookie,
    body: { payload: "XKNOT_HUB_RELAY_TOKEN=xkr_wang_secret", ttlHours: 72 },
  });
  assert.equal(handoff.status, 200);
  assert.match(handoff.data.claimUrl, /\/claim\//);

  await new Promise((resolve) => setImmediate(resolve));
  const handoffMail = mailer.sent.find((mail) => /接入资料已就绪/.test(mail.subject));
  assert.ok(handoffMail, "handoff mail must be sent");
  assert.ok(!handoffMail.text.includes("xkr_wang_secret"), "secrets never go into mail");

  const token = tokenFromMail(handoff.data.claimUrl, "claim");
  const page = await call(`/claim/${token}`);
  assert.equal(page.status, 200);

  const claimed = await call("/api/claim", { method: "POST", form: { token } });
  assert.equal(claimed.status, 200);
  assert.match(claimed.data, /xkr_wang_secret/);

  const second = await call("/api/claim", { method: "POST", form: { token } });
  assert.equal(second.status, 409);
  assert.ok(!second.data.includes("xkr_wang_secret"));

  const log = store.listNotifyLog(20);
  assert.ok(log.some((row) => row.event === "partner.handoff" && row.status === "sent"));
});

test("api: a repeated review cannot mail twice or leave the state machine", async (t) => {
  const mailer = recordingMailer();
  const { call, store, verify } = await start(t, { mailer, adminEmail: "admin@example.com" });
  const cookie = await loginAs(call, store);
  const submitted = await call("/api/applications", { method: "POST", body: { ...valid, locale: "zh-CN" } });
  await verify(submitted.data.application);
  const id = submitted.data.application.id;

  assert.equal(
    (await call(`/api/admin/applications/${id}/review`, { method: "POST", cookie, body: { decision: "approve" } })).status,
    200
  );
  const again = await call(`/api/admin/applications/${id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "approve" },
  });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, "invalid_transition");

  await new Promise((resolve) => setImmediate(resolve));
  const approved = mailer.sent.filter((mail) => /已通过收录审核/.test(mail.subject));
  assert.equal(approved.length, 1);
});

test("api: hold carries coded items and resume returns to review", async (t) => {
  const { call, store, verify } = await start(t);
  const cookie = await loginAs(call, store);
  const submitted = await call("/api/applications", { method: "POST", body: valid });
  await verify(submitted.data.application);
  const id = submitted.data.application.id;

  const held = await call(`/api/admin/applications/${id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "hold", items: ["health_missing", "not_a_code"] },
  });
  assert.equal(held.status, 200);
  assert.deepEqual(held.data.application.holdItems, ["health_missing"]);

  const resumed = await call(`/api/admin/applications/${id}/review`, {
    method: "POST",
    cookie,
    body: { decision: "resume" },
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.application.status, "verified");
});

test("api: locale drives the language of the partner mail", async (t) => {
  const mailer = recordingMailer();
  const { call } = await start(t, { mailer, adminEmail: "admin@example.com" });
  await call("/api/applications", { method: "POST", body: { ...valid, locale: "zh-TW" } });
  await new Promise((resolve) => setImmediate(resolve));
  const partner = mailer.sent.find((mail) => mail.to === "lin@example.com");
  assert.match(partner.subject, /已收到加入申請/);
  assert.match(partner.text, /不接收回覆/);
});

test("api: admin edits instance config and both files are validated", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-app-edit-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const instancesFile = path.join(dir, "instances.json");
  const federationFile = path.join(dir, "federation.json");
  const instance = {
    id: "wang",
    url: "https://wang.xknot.si",
    since: "2026-10-19",
    tier: "partner",
    status: "active",
  };
  const member = {
    id: "wang",
    host: "wang.xknot.si",
    role: "founder",
    standing: "permanent",
    mode: "subdomain",
    tunnel: { account: "knot-tunnel", port: 18080 },
    listed: true,
    since: "2026-10-19",
  };
  writeFileSync(
    instancesFile,
    `${JSON.stringify({ version: 3, updatedAt: "2026-10-19", instances: [instance] }, null, 2)}\n`
  );
  writeFileSync(
    federationFile,
    `${JSON.stringify({ version: 1, updatedAt: "2026-10-19", hub: "xknot.si", members: [member] }, null, 2)}\n`
  );

  const { call, store } = await start(t, {
    instances: [instance],
    federation: { hub: "xknot.si", members: [member] },
    instancesFile,
    federationFile,
  });
  const cookie = await loginAs(call, store);

  const saved = await call("/api/admin/instances/wang/config", {
    method: "POST",
    cookie,
    body: {
      instance: { status: "suspended" },
      member: { mode: "subdomain", listed: true, host: "wang.xknot.si" },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.ok, true);

  const manifest = JSON.parse(readFileSync(instancesFile, "utf8"));
  assert.equal(manifest.instances[0].status, "suspended");
  assert.equal(manifest.instances[0].name, undefined, "自述区不写进登记表");
  const roster = JSON.parse(readFileSync(federationFile, "utf8"));
  assert.equal(roster.members[0].mode, "subdomain");
  assert.ok(store.events(5).some((event) => event.kind === "instance.updated"));

  const rejected = await call("/api/admin/instances/wang/config", {
    method: "POST",
    cookie,
    body: { instance: { url: "http://plain.example" } },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.data.error, "invalid");
  assert.ok(rejected.data.fields.some((field) => field.includes("url")));
  assert.equal(
    JSON.parse(readFileSync(instancesFile, "utf8")).instances[0].url,
    "https://wang.xknot.si",
    "校验失败不写文件"
  );

  const anonymous = await call("/api/admin/instances/wang/config", {
    method: "POST",
    body: { instance: { status: "active" } },
  });
  assert.equal(anonymous.status, 401);
});

/* ---- 成员入口与子域查询 ---- */

const MEMBER_INSTANCE = {
  id: "nordhavn",
  url: "https://nordhavn.xknot.si",
  since: "2026-10-01",
  tier: "community",
  status: "active",
};

function memberFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "xknot-member-"));
  for (const name of ["profiles", "stats", "cards"]) mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(
    path.join(dir, "profiles", "nordhavn.json"),
    JSON.stringify({
      formatVersion: 2,
      updatedAt: "2026-10-20",
      site: { name: "北港", tagline: "北海沿岸的慢阅读与长文笔记。" },
      fetchedAt: "2026-10-20T08:00:00.000Z",
    })
  );
  writeFileSync(
    path.join(dir, "stats", "nordhavn.json"),
    JSON.stringify({
      posts: { total: 42, last24h: 3 },
      accounts: { total: 7 },
      fetchedAt: "2026-10-20T09:00:00.000Z",
    })
  );
  writeFileSync(path.join(dir, "cards", "nordhavn.json"), JSON.stringify({ cards: [{}, {}] }));
  return dir;
}

async function startMember(t) {
  const dir = memberFixture();
  const sent = [];
  const mailer = {
    send: async (message) => {
      sent.push(message);
      return { ok: true };
    },
  };
  const health = {
    instances: { nordhavn: { status: "up", latencyMs: 42, lastOkAt: "2026-10-21T06:00:00.000Z" } },
    checkedAt: "2026-10-21T06:05:00.000Z",
  };
  const app = await start(t, {
    mailer,
    instances: [MEMBER_INSTANCE],
    health,
    profilesDir: path.join(dir, "profiles"),
    statsDir: path.join(dir, "stats"),
    cardsDir: path.join(dir, "cards"),
  });
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const application = app.store.createApplication({ ...valid, email: "lin@example.com" });
  app.store.markEmailVerified(application.id);
  app.store.transition({ id: application.id, to: "approved" });
  return { ...app, sent, mailer };
}

test("member: 非成员与成员拿到同一句回执，只有成员收得到信", async (t) => {
  const { call, sent } = await startMember(t);

  const outsider = await call("/api/member/code", {
    method: "POST",
    body: { email: "nobody@example.com" },
  });
  assert.equal(outsider.status, 202);
  assert.equal(sent.length, 0, "非成员不发信");

  const member = await call("/api/member/code", {
    method: "POST",
    body: { email: "LIN@example.com" },
  });
  assert.equal(member.status, 202);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "lin@example.com");
  assert.match(sent[0].text, /\b\d{6}\b/);
});

test("member: 授权码只能用一次，登录后能看到本站的健康、计数与橱窗", async (t) => {
  const { call, sent } = await startMember(t);

  await call("/api/member/code", { method: "POST", body: { email: "lin@example.com" } });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const code = sent[0].text.match(/\b(\d{6})\b/)[1];

  const login = await call("/api/member/session", {
    method: "POST",
    body: { email: "lin@example.com", code },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.session.instanceId, "nordhavn");
  assert.equal(login.data.overview.site.name, "北港");
  assert.equal(login.data.overview.health.status, "up");
  assert.equal(login.data.overview.health.latencyMs, 42);
  assert.equal(login.data.overview.stats.posts.total, 42);
  assert.equal(login.data.overview.stats.posts.last24h, 3);
  assert.equal(login.data.overview.cards, 2);
  assert.equal(login.data.overview.listed, true);

  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^xknot_member=/);

  const again = await call("/api/member/session", { method: "POST", body: { email: "lin@example.com", code } });
  assert.equal(again.status, 401, "同一枚码不能用第二次");

  const current = await call("/api/member/session", { cookie });
  assert.equal(current.status, 200);
  assert.equal(current.data.overview.member.email, "lin@example.com");

  const out = await call("/api/member/logout", { method: "POST", cookie, body: {} });
  assert.equal(out.status, 200);
  assert.equal((await call("/api/member/session", { cookie })).status, 401);
});

test("member: 同一邮箱十分钟内最多要三枚码", async (t) => {
  const { call } = await startMember(t);
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call("/api/member/code", { method: "POST", body: { email: "lin@example.com" } })).status, 202);
  }
  const fourth = await call("/api/member/code", { method: "POST", body: { email: "lin@example.com" } });
  assert.equal(fourth.status, 429);
  assert.equal(fourth.data.error, "rate_limited");
});

test("subdomain: 太短、保留词、已占用与可用各给一个理由", async (t) => {
  const { call, store } = await startMember(t);

  const short = await call("/api/subdomains/check?label=abc");
  assert.equal(short.status, 200);
  assert.equal(short.data.available, false);
  assert.equal(short.data.reason, "too_short");
  assert.equal(short.data.min, 6);

  assert.equal((await call("/api/subdomains/check?label=status")).data.reason, "reserved");

  // 名册里的实例占着自己的标签
  assert.equal((await call("/api/subdomains/check?label=nordhavn")).data.reason, "taken");

  // 还在审核里的申请也占着
  store.createApplication({ ...valid, subdomain: "pending-one", email: "other@example.com" });
  assert.equal((await call("/api/subdomains/check?label=pending-one")).data.reason, "taken");

  const free = await call("/api/subdomains/check?label=Hello-World");
  assert.equal(free.data.available, true);
  assert.equal(free.data.label, "hello-world");

  const whole = await call("/api/subdomains/check?label=https://hello-world.xknot.si/");
  assert.equal(whole.data.label, "hello-world");
  assert.equal(whole.data.available, true);
});
