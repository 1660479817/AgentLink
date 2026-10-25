import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { installSystemPolicy } from "../system.js";
import { webRouter } from "./web.js";

// 这个文件只测会话层与公开快照的关系：信息流不在响应里，快照来自参数里的 board()。
// `/home` 用它算个人状态，`/session` 用它给出实例侧版本，`/board` 把同一份原样发出。
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
    return await fn({ call: (pathname, init) => fetch(`${base}${pathname}`, init), fake });
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

// ---- 入口磁盘上的快照可能落后：实例给出它自己那份 ----

test("会话响应带回实例侧的快照版本，访客与登录的人都一样", async () => {
  // 页面靠它判断屏幕上那份（入口磁盘）要不要回源校正。它是每次打开都要走的一趟，
  // 顺手带回即可，不为这一项多一次请求。
  const board = async () => ({ version: "2026-10-25T01:02:03.000Z", information: [], requests: [] });
  for (const signedIn of [false, true]) {
    await withHome(
      async ({ call }) => {
        const data = await (await call("/session")).json();
        assert.equal(data.boardVersion, "2026-10-25T01:02:03.000Z");
      },
      { signedIn, board }
    );
  }
});

test("没有快照或没传 board 时，版本为 null", async () => {
  await withHome(
    async ({ call }) => {
      assert.equal((await (await call("/session")).json()).boardVersion, null);
    },
    { signedIn: true, board: async () => null }
  );
  await withHome(async ({ call }) => {
    assert.equal((await (await call("/session")).json()).boardVersion, null);
  });
});

test("/board 原样给出快照，且不许任何一层缓存留", async () => {
  const board = async () => ({ version: "2026-10-25T00:00:00.000Z", information: [{ id: POST }], requests: [] });
  await withHome(
    async ({ call }) => {
      const response = await call("/board");
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json();
      assert.deepEqual(data.information, [{ id: POST }]);
    },
    { board }
  );
});

test("/board 的 ETag 就是快照版本：没变只花一次往返，不传正文", async () => {
  // 中枢按间隔来取这一条，一天几百次；每次都发几十 KB 会把实例的上行占满。
  const board = async () => ({ version: "2026-10-25T00:00:00.000Z", information: [], requests: [] });
  await withHome(
    async ({ call }) => {
      const first = await call("/board");
      const etag = first.headers.get("etag");
      assert.equal(etag, '"2026-10-25T00:00:00.000Z"');
      await first.arrayBuffer();

      const again = await call("/board", { headers: { "if-none-match": etag } });
      assert.equal(again.status, 304);
      assert.equal((await again.arrayBuffer()).byteLength, 0);
    },
    { board }
  );
});

test("/board 在快照关掉时回 410，让取回方把入口那份撤下", async () => {
  // 用 410 而不是 404，取回方才能分清「实例说没有快照」与「这条地址不存在」：
  // 弄反了会在实例还没升级时撤掉一份还能用的快照。
  const board = async () => ({ version: "2026-10-25T00:00:00.000Z", information: [{ id: POST }], requests: [] });
  installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: false });
  try {
    await withHome(
      async ({ call }) => {
        const response = await call("/board");
        assert.equal(response.status, 410);
        assert.equal((await response.json()).error, "board_unavailable");
      },
      { board }
    );
  } finally {
    installSystemPolicy({ guestBrowsing: true, registrationMode: "open", publicBoard: true });
  }
});

test("/board 没有快照时也回 410，不把空内容当成一份快照", async () => {
  await withHome(async ({ call }) => {
    assert.equal((await call("/board")).status, 410);
  });
});

test("/board 认 W/ 前缀的 ETag", async () => {
  // 取回方与中间的代理都可能给 ETag 加弱校验前缀，等值比较会漏掉这种校验。
  const board = async () => ({ version: "2026-10-25T00:00:00.000Z", information: [], requests: [] });
  await withHome(
    async ({ call }) => {
      const response = await call("/board", { headers: { "if-none-match": 'W/"2026-10-25T00:00:00.000Z"' } });
      assert.equal(response.status, 304);
    },
    { board }
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
