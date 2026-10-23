import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createApp } from "./app.mjs";
import { openMemoryStore } from "./store.mjs";

// 这一份盯接口层的边界：请求体上限、限流桶的键、页面动作失败时的去处。
// 都从真实 HTTP 打进去——readBody 与限流都在 handle 里面，
// 直接调函数验不出「响应还发不发得出来」。

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

async function start(t, config = {}) {
  const store = openMemoryStore();
  const { handle } = createApp({
    store,
    config: {
      secret: "test",
      adminDir: null,
      mailer: null,
      adminEmail: "",
      origin: "https://xknot.si",
      replyTo: "",
      supportUrl: "",
      instances: [],
      instancesProvider: () => [],
      federationProvider: () => null,
      healthProvider: () => null,
      instancesFile: null,
      federationFile: null,
      profilesDir: null,
      statsDir: null,
      cardsDir: null,
      ...config,
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

  async function call(path, { method = "GET", body, text, headers = {}, cookie } = {}) {
    const out = { accept: "application/json", ...headers };
    let payload;
    if (text !== undefined) {
      payload = text;
      out["content-type"] = "application/json";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      out["content-type"] = "application/json";
    }
    if (cookie) out.cookie = cookie;
    const response = await fetch(base + path, { method, headers: out, body: payload, redirect: "manual" });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = raw;
    }
    return { status: response.status, data, headers: response.headers };
  }

  return { store, call, base };
}

test("body limit: an oversized submission gets a 413 answer, not a dropped connection", async (t) => {
  const { call } = await start(t);

  // 16KB 上限之外再塞一段：readBody 不能先 destroy 再想回话，
  // 否则客户端看到的是 ECONNRESET，拿不到 too_large 与 413。
  const huge = { ...valid, intro: "x".repeat(20 * 1024) };
  const refused = await call("/api/applications", { method: "POST", body: huge });
  assert.equal(refused.status, 413);
  assert.equal(refused.data.error, "too_large");

  // 同一个连接池里紧接着的正常提交必须还能走通。
  const ok = await call("/api/applications", { method: "POST", body: valid });
  assert.equal(ok.status, 201);
});

test("health: only GET and HEAD answer, other methods are 405", async (t) => {
  const { call } = await start(t);
  assert.equal((await call("/api/health")).status, 200);
  assert.equal((await call("/api/health", { method: "HEAD" })).status, 200);
  assert.equal((await call("/api/health", { method: "POST", body: {} })).status, 405);
});

test("case page: a refused key comes back with a marker instead of a silent reload", async (t) => {
  const { call, store } = await start(t);
  const submitted = await call("/api/applications", { method: "POST", body: valid });
  const application = store.getApplication(submitted.data.application.id);
  const key = application.caseKey;

  const invalid = await call(`/api/case/${key}/public-key`, {
    method: "POST",
    body: { publicKey: "ssh-ed25519 bad\nssh-rsa AAAAB3NzaC1yc2EAAAA" },
  });
  assert.equal(invalid.status, 303);
  assert.equal(invalid.headers.get("location"), `/case/${key}?key=invalid`);

  const page = await call(`/case/${key}?key=invalid`);
  assert.equal(page.status, 200);
  assert.match(page.data, /The key was not saved/, "页面上要能看出刚才没存上");

  store.withdrawApplication(application.id);
  const closed = await call(`/api/case/${key}/public-key`, {
    method: "POST",
    body: { publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleKeyMaterial case" },
  });
  assert.equal(closed.headers.get("location"), `/case/${key}?key=closed`);
  const closedPage = await call(`/case/${key}?key=closed`);
  assert.match(closedPage.data, /withdrawn|closed/i, "撤回之后要说清为什么没存上");
});

test("page view: one address hammering a case page is cut off", async (t) => {
  const { call } = await start(t);
  const submitted = await call("/api/applications", { method: "POST", body: valid });
  const key = submitted.data.application.caseKey;

  // 每分钟 60 次：案例页会解一次 JSON、查一次库，不能让人一直刷。
  let last = null;
  for (let index = 0; index < 61; index += 1) {
    last = await call(`/case/${key}`);
  }
  assert.equal(last.status, 429);
});

test("admin login: the per-account bucket uses the same normalization as the lookup", async (t) => {
  // 走了反代才能用 X-Forwarded-For 换来源地址：这样每个请求的 IP 桶都是新的，
  // 只剩「同一个账号」那个桶会累积。
  const { call, store } = await start(t, { trustProxy: true });
  store.createAdmin({ username: "paul", password: "correct-horse-battery" });

  // 大小写与首尾空格是同一个账号：不归一化的话，换个写法就换一个桶。
  const spellings = ["paul", "Paul", " paul ", "PAUL", "paul\t"];
  let last = null;
  for (let index = 0; index < 12; index += 1) {
    last = await call("/api/admin/login", {
      method: "POST",
      body: { username: spellings[index % spellings.length], password: "wrong-password" },
      headers: { "x-forwarded-for": `10.0.0.${index + 1}` },
    });
    assert.equal(last.status, 401, "前 12 次只是密码错");
  }

  const blocked = await call("/api/admin/login", {
    method: "POST",
    body: { username: "PAUL", password: "correct-horse-battery" },
    headers: { "x-forwarded-for": "10.0.0.200" },
  });
  assert.equal(blocked.status, 429, "换写法、换地址也还在同一个账号的桶里");
  assert.equal(blocked.data.error, "rate_limited");
});
