import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { installSystemPolicy } from "../system.js";
import { webRouter } from "./web.js";

// 这个文件只测首页的会话层：公开信息流不在响应里，快照来自参数里的 board()。
installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: true });

const USER = "11111111-1111-4111-8111-111111111111";
const POST = "22222222-2222-4222-8222-222222222222";
const AGENT = "33333333-3333-4333-8333-333333333333";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function accountRow(overrides = {}) {
  return {
    id: USER,
    role: "user",
    email: "a@example.com",
    display_name: "甲",
    avatar_upload_id: null,
    level: 1,
    entitlements: {},
    points_balance: 20,
    muted_until: null,
    locale: null,
    bio: "",
    ...overrides,
  };
}

// 只按 SQL 里最稳的那几段辨认：这条路由一共会问四类问题。
function pool({ user = accountRow(), agents = [], unread = 0, selfRows = [] } = {}) {
  const seen = [];
  return {
    seen,
    async query(sql) {
      seen.push(sql);
      if (sql.includes("FROM accounts WHERE id = $1")) return { rows: user ? [user] : [] };
      if (sql.includes("owner_id = $1")) return { rows: agents };
      if (sql.includes("FROM notifications")) return { rows: [{ n: unread }] };
      if (sql.includes("ANY($2::uuid[])")) return { rows: selfRows };
      return { rows: [] };
    },
  };
}

async function withHome(fn, { signedIn = false, fake = pool(), board = null, agentDoc } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-home-"));
  const app = express();
  app.use(express.json());
  if (signedIn) {
    app.use((req, _res, next) => {
      req.account = { id: USER };
      next();
    });
  }
  app.use(
    "/api/web",
    webRouter({
      pool: fake,
      sessionCookieName: "knot_sid",
      uploadDir: dir,
      profile: null,
      board,
      agentDoc,
    })
  );
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/web`;
  try {
    return await fn({ call: (pathname) => fetch(`${base}${pathname}`), fake });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("没有会话也可以问首页：站点开关照给，个人状态为空", async () => {
  await withHome(async ({ call, fake }) => {
    const response = await call("/home");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.user, null);
    assert.equal(data.agentDelegated, false);
    assert.equal(data.unread, 0);
    assert.equal(data.site.publicBoard, true);
    assert.equal(data.site.guestBrowsing, true);
    assert.deepEqual(data.self.dismissed, []);
    // 匿名请求不碰数据库。
    assert.equal(fake.seen.length, 0);
  });
});

// Agent 指引在联邦中枢，不在本实例。地址由 Backend 注入，WebUI 不自己拼
// location.origin，否则会把 /help 拼成一个已经不存在的页面。
test("会话层带上 Agent 指引的两个地址，没配置时回落到联邦入口", async () => {
  await withHome(async ({ call }) => {
    const data = await (await call("/session")).json();
    assert.deepEqual(data.agentDoc, {
      page: "https://xknot.si/knot-help",
      raw: "https://xknot.si/knot-help.md",
    });
  });
  await withHome(
    async ({ call }) => {
      const data = await (await call("/session")).json();
      assert.deepEqual(data.agentDoc, { page: "http://127.0.0.1:5180/knot-help", raw: "http://127.0.0.1:5180/knot-help.md" });
    },
    { agentDoc: { page: "http://127.0.0.1:5180/knot-help", raw: "http://127.0.0.1:5180/knot-help.md" } }
  );
});

test("登录后一次带回会话、Agent、未读数和快照上的个人状态", async () => {
  const fake = pool({
    agents: [{ id: AGENT }],
    unread: 3,
    selfRows: [{ id: POST, kind: "post", dismissed: true, starred: true, liked: false, friend: false, granted: false, mine: false }],
  });
  const board = async () => ({ version: "2026-10-22T00:00:00.000Z", information: [{ id: POST }], requests: [] });
  await withHome(
    async ({ call }) => {
      const response = await call("/home");
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.user.id, USER);
      assert.equal(data.agentDelegated, true);
      assert.equal(data.unread, 3);
      assert.equal(data.boardVersion, "2026-10-22T00:00:00.000Z");
      assert.deepEqual(data.self.dismissed, [POST]);
      assert.deepEqual(data.self.starred, [POST]);
      // 信息流不在这里发：它来自入口磁盘上的快照。
      assert.equal(data.information, undefined);
    },
    { signedIn: true, fake, board }
  );
});

test("快照还没写下来时，首页仍然回会话，只是没有个人状态", async () => {
  await withHome(
    async ({ call }) => {
      const data = await (await call("/home")).json();
      assert.equal(data.user.id, USER);
      assert.equal(data.boardVersion, null);
      assert.deepEqual(data.self.starred, []);
    },
    { signedIn: true, board: async () => null }
  );
});

test("不传 board 时不报错，个人状态留空", async () => {
  await withHome(
    async ({ call }) => {
      const response = await call("/home");
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.self.dismissed, []);
    },
    { signedIn: true }
  );
});

test("通知轮询只要一个数字", async () => {
  const fake = pool({ unread: 5 });
  await withHome(
    async ({ call }) => {
      const data = await (await call("/notifications?count=1")).json();
      assert.equal(data.unread, 5);
      assert.equal(data.notifications, undefined);
    },
    { signedIn: true, fake }
  );
});
