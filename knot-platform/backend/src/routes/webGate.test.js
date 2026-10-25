// WebUI 门禁分支的用例：站内浏览关掉时的 401、管理入口的三种拒绝、
// 平台关闭与上传端点的无会话拒绝。这里只走路由，不碰真实数据。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { installSystemPolicy, resetSystemPolicy } from "../system.js";
import { webRouter } from "./web.js";

const USER = "11111111-1111-4111-8111-111111111111";
const INTEL = "22222222-2222-4222-8222-222222222222";
const UPLOAD = "33333333-3333-4333-8333-333333333333";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// 只认「问角色」和「读上传行」这两类查询；其余一律空结果。
function pool({ role = "owner", upload = null } = {}) {
  return {
    async query(sql) {
      if (sql.includes("SELECT role FROM accounts")) return { rows: [{ role }] };
      if (sql.includes("FROM uploads u")) return { rows: upload ? [upload] : [] };
      return { rows: [] };
    },
  };
}

async function withWeb(fn, { signedIn = false, ...options } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-gate-"));
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
      pool: options.pool || pool(options),
      sessionCookieName: "knot_sid",
      uploadDir: dir,
      profile: null,
      board: null,
      handoff: options.handoff || null,
    })
  );
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/web`;
  try {
    return await fn({ base, call: (pathname, init) => fetch(`${base}${pathname}`, init) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("站内浏览关掉后，没有会话的内容接口统一回 401", async () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "open", publicBoard: true });
  try {
    await withWeb(async ({ call }) => {
      const paths = [
        `/search?q=住房`,
        "/facets",
        "/store",
        "/people",
        "/information",
        `/intel/${INTEL}`,
        `/intel/${INTEL}/share`,
        "/discover-self",
      ];
      for (const pathname of paths) {
        const response = await call(pathname, { method: pathname === "/discover-self" ? "POST" : "GET" });
        assert.equal(response.status, 401, pathname);
        assert.deepEqual(await response.json(), { error: "no_session" }, pathname);
      }
    });
  } finally {
    resetSystemPolicy();
  }
});

test("站内浏览关掉后，内容媒体没有会话就 404，头像那类不受影响", async () => {
  installSystemPolicy({ guestBrowsing: false, registrationMode: "open", publicBoard: true });
  try {
    const upload = {
      storage_name: `${UPLOAD}.jpg`,
      mime: "image/jpeg",
      original_name: "a.jpg",
      account_id: USER,
      avatar: false,
      sponsor: false,
    };
    await withWeb(
      async ({ call }) => {
        const response = await call(`/uploads/${UPLOAD}`);
        assert.equal(response.status, 404);
      },
      { pool: pool({ upload }) }
    );
  } finally {
    resetSystemPolicy();
  }
});

test("管理入口：无会话 401，非主理人 403，没配令牌 503", async () => {
  await withWeb(async ({ call }) => {
    const anonymous = await call("/admin-handoff", { method: "POST" });
    assert.equal(anonymous.status, 401);
    assert.deepEqual(await anonymous.json(), { error: "no_session" });
  });
  await withWeb(
    async ({ call }) => {
      const denied = await call("/admin-handoff", { method: "POST" });
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { error: "not_admin" });
    },
    { signedIn: true, role: "user" }
  );
  await withWeb(
    async ({ call }) => {
      const unconfigured = await call("/admin-handoff", { method: "POST" });
      assert.equal(unconfigured.status, 503);
      assert.deepEqual(await unconfigured.json(), { error: "admin_unconfigured" });
    },
    { signedIn: true, role: "owner" }
  );
});

test("平台关闭只认主理人", async () => {
  await withWeb(
    async ({ call }) => {
      const response = await call(`/intel/${INTEL}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "违规" }),
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "not_admin" });
    },
    { signedIn: true, role: "user" }
  );
});

test("改资料与三个上传端点都先要会话", async () => {
  await withWeb(async ({ call }) => {
    const profile = await call("/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "乙" }),
    });
    assert.equal(profile.status, 401);
    assert.deepEqual(await profile.json(), { error: "no_session" });

    for (const pathname of ["/uploads", "/audio", "/files"]) {
      const response = await call(pathname, { method: "POST" });
      assert.equal(response.status, 401, pathname);
      assert.deepEqual(await response.json(), { error: "no_session" }, pathname);
    }
  });
});
