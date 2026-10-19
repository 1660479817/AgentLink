import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApp } from "./app.mjs";
import { checkManifestEntry, suggestId, toManifestEntry } from "./manifest.mjs";
import { openMemoryStore } from "./store.mjs";
import { normalizeTags, normalizeUrl, validateApplication } from "./validate.mjs";

const valid = {
  name: "北港",
  url: "https://nordhavn.example",
  operator: "Lin",
  email: "lin@example.com",
  region: "NO",
  timezone: "Europe/Oslo",
  intro: "北海沿岸的慢阅读与长文笔记。",
  tags: "长文, 设计",
  agree: true,
};

async function start(t) {
  const store = openMemoryStore();
  const { handle } = createApp({ store, config: { secret: "test", adminDir: null } });
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

  async function call(path, { method = "GET", body, cookie, origin } = {}) {
    const headers = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
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

  return { store, call, base };
}

function adminCookie(result) {
  const raw = result.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

test("validate: a complete application passes and is normalized", () => {
  const result = validateApplication(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.url, "https://nordhavn.example");
  assert.deepEqual(result.value.tags, ["长文", "设计"]);
  assert.equal(result.value.email, "lin@example.com");
});

test("validate: missing and malformed fields report per-field codes", () => {
  const result = validateApplication({ ...valid, url: "nordhavn", email: "lin@", agree: false });
  assert.equal(result.ok, false);
  assert.equal(result.errors.url, "invalid_url");
  assert.equal(result.errors.email, "invalid_email");
  assert.equal(result.errors.agree, "required");
});

test("validate: non-https, credentials in URL and unknown regions are rejected", () => {
  assert.equal(validateApplication({ ...valid, url: "ftp://a.example" }).errors.url, "invalid_url");
  assert.equal(validateApplication({ ...valid, url: "https://u:p@a.example" }).errors.url, "invalid_url");
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
  assert.equal(normalizeUrl("https://a.example/"), "https://a.example");
});

test("api: submission returns an id and lands in the pending queue", async (t) => {
  const { call, store } = await start(t);
  const result = await call("/api/applications", { method: "POST", body: { ...valid, locale: "zh-CN" } });
  assert.equal(result.status, 201);
  assert.match(result.data.application.id, /^XK-\d{4}-[0-9A-Z]{6}$/);
  assert.equal(result.data.application.status, "pending");
  assert.equal(store.listApplications({ status: "pending" }).length, 1);
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
      body: { ...valid, url: `https://site${index}.example` },
    });
  }
  assert.equal(last.status, 429);
  assert.ok(Number(last.headers.get("retry-after")) > 0);
});

test("api: admin endpoints require a session", async (t) => {
  const { call } = await start(t);
  assert.equal((await call("/api/admin/applications")).status, 401);
  assert.equal((await call("/api/admin/session")).status, 401);
});

test("api: wrong password and unknown user are both rejected", async (t) => {
  const { call, store } = await start(t);
  store.createAdmin({ username: "paul", password: "correct-horse-battery" });
  assert.equal((await call("/api/admin/login", { method: "POST", body: { username: "paul", password: "nope" } })).status, 401);
  assert.equal((await call("/api/admin/login", { method: "POST", body: { username: "ghost", password: "nope" } })).status, 401);
});

test("api: an admin reviews an application and gets a valid manifest entry", async (t) => {
  const { call, store } = await start(t);
  store.createAdmin({ username: "paul", password: "correct-horse-battery" });
  const login = await call("/api/admin/login", {
    method: "POST",
    body: { username: "paul", password: "correct-horse-battery" },
  });
  assert.equal(login.status, 200);
  const cookie = adminCookie(login);

  const submitted = await call("/api/applications", { method: "POST", body: valid });
  const id = submitted.data.application.id;

  const listed = await call("/api/admin/applications?status=pending", { cookie });
  assert.equal(listed.status, 200);
  assert.equal(listed.data.applications.length, 1);
  assert.equal(listed.data.counts.pending, 1);

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
  assert.equal(entry.url, "https://nordhavn.example");
  assert.deepEqual(entry.regions, ["NO"]);
  assert.equal(entry.tier, "community");
  assert.equal(entry.healthUrl, "https://nordhavn.example/api/health");
  assert.deepEqual(checkManifestEntry(entry), []);
  assert.match(entry.id, /^[a-z0-9][a-z0-9-]*$/);
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
