import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { createProfileStore } from "../profile.js";
import { adminRouter } from "./admin.js";

const TOKEN = "test-token";
const HUB = "https://hub.example";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

const realFetch = globalThis.fetch;

// 只截中枢的请求；发往本地测试服务器的照常走真 fetch。
function stubHub(handler) {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith(HUB)) return handler(href, init);
    return realFetch(url, init);
  };
}

function hubReply(status, body) {
  return { status, text: async () => JSON.stringify(body) };
}

async function withJoinAdmin(fn, { site = null } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-xknot-"));
  const file = path.join(dir, "profile.json");
  const store = createProfileStore({ file });
  if (site) await store.save({ site });

  const previous = process.env.KNOT_HUB_ORIGIN;
  process.env.KNOT_HUB_ORIGIN = HUB;

  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: {}, token: TOKEN, profile: store, publicWebOrigin: "https://knot.example" }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const call = (pathname, options = {}) =>
    realFetch(`${base}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });

  try {
    return await fn({ call });
  } finally {
    globalThis.fetch = realFetch;
    if (previous == null) delete process.env.KNOT_HUB_ORIGIN;
    else process.env.KNOT_HUB_ORIGIN = previous;
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

const SITE = {
  name: "北港",
  tagline: "北海沿岸的慢阅读与长文笔记。",
  owner: "Lin",
  contact: "lin@example.com",
  region: "NO",
  timezone: "Europe/Oslo",
  tags: ["长文"],
};

test("子域检查转发给中枢，结论与候选原样返回", async () => {
  await withJoinAdmin(async ({ call }) => {
    stubHub(async (url) => {
      assert.equal(url, `${HUB}/api/subdomains/check?label=hello`);
      return hubReply(200, {
        label: "hello",
        available: false,
        reason: "too_short",
        min: 6,
        suggestions: ["hello2"],
      });
    });

    const response = await call("/xknot/subdomain?label=hello");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.available, false);
    assert.equal(data.reason, "too_short");
    assert.deepEqual(data.suggestions, ["hello2"]);
  });
});

test("中枢连不上时给 502，不假装成「不可用」", async () => {
  await withJoinAdmin(async ({ call }) => {
    stubHub(async () => {
      throw new Error("ECONNREFUSED");
    });
    const response = await call("/xknot/subdomain?label=hello-world");
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "hub_unreachable");
  });
});

test("提交申请：自述区转成中枢的字段，201 原样带回", async () => {
  await withJoinAdmin(async ({ call }) => {
    let sent = null;
    stubHub(async (url, init) => {
      assert.equal(url, `${HUB}/api/applications`);
      sent = JSON.parse(init.body);
      return hubReply(201, { application: { id: "XK-1", caseUrl: `${HUB}/case/k` } });
    });

    const response = await call("/xknot/apply", {
      method: "POST",
      body: JSON.stringify({ subdomain: "nordhavn", email: "lin@example.com" }),
    });
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.application.id, "XK-1");
    assert.equal("mode" in sent, false);
    assert.equal(sent.subdomain, "nordhavn");
    assert.equal(sent.operator, "Lin");
    assert.equal(sent.intro, SITE.tagline);
    assert.equal(sent.region, "NO");

    // 编号与案例链接只在这个响应里出现一次：底账要留下，刷新后还能看进度。
    const recorded = await call("/xknot/application");
    assert.equal(recorded.status, 200);
    const state = await recorded.json();
    assert.equal(state.application.id, "XK-1");
    assert.equal(state.application.caseUrl, `${HUB}/case/k`);
    assert.ok(state.file.endsWith("join.json"));
  }, { site: SITE });
});

test("档案缺项时在本地就拒绝，不往中枢发", async () => {
  await withJoinAdmin(async ({ call }) => {
    let called = 0;
    stubHub(async () => {
      called += 1;
      return hubReply(201, {});
    });

    const response = await call("/xknot/apply", {
      method: "POST",
      body: JSON.stringify({ subdomain: "nordhavn", email: "" }),
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.error, "incomplete");
    assert.ok(data.fields.includes("name"));
    assert.equal(called, 0);
  });
});

test("中枢判重时返回 409，让主理人知道不该再交一张", async () => {
  await withJoinAdmin(async ({ call }) => {
    stubHub(async () => hubReply(409, { error: "duplicate" }));
    const response = await call("/xknot/apply", {
      method: "POST",
      body: JSON.stringify({ subdomain: "nordhavn", email: "lin@example.com" }),
    });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "duplicate");
  }, { site: SITE });
});
