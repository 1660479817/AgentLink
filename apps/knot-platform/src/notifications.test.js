import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { noticeGroup, noticeSummary } from "./notifications.js";
import { agentRouter } from "./routes/agent.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("notices split into platform actions and social activity", () => {
  assert.equal(noticeGroup("warning"), "system");
  assert.equal(noticeGroup("intel_removed"), "system");
  assert.equal(noticeGroup("points_granted"), "system");
  assert.equal(noticeGroup("mention"), "social");
  assert.equal(noticeGroup("request_response"), "social");
  // 认不出的类别当成平台动作，宁可见到也不要沉底。
  assert.equal(noticeGroup("something_new"), "system");
});

test("the summary counts by group and keeps a constant shape", async () => {
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push(params);
      if (sql.includes("GROUP BY kind")) {
        return {
          rows: [
            { kind: "warning", n: 2 },
            { kind: "mention", n: 1 },
          ],
        };
      }
      return {
        rows: [
          {
            id: "n1",
            kind: "warning",
            title: "平台警告",
            body: "别再发重复的",
            href: null,
            intel_id: null,
            read_at: null,
            created_at: "2026-10-16T09:00:00.000Z",
          },
        ],
      };
    },
  };
  const summary = await noticeSummary(pool, USER_ID);
  assert.equal(summary.unread, 3);
  assert.deepEqual(summary.groups, { system: 2, social: 1 });
  assert.equal(summary.latest.length, 1);
  assert.equal(summary.latest[0].kind, "warning");
  assert.equal(summary.latest[0].title, "平台警告");
  assert.equal(summary.latest[0].read, false);
  // 未读优先、system 优先，都交给 SQL 排，不在这里再分一次组。
  assert.ok(seen[1][1].includes("warning"));
  assert.ok(!seen[1][1].includes("mention"));
});

test("an empty inbox still has the shape", async () => {
  const pool = {
    async query() {
      return { rows: [] };
    },
  };
  assert.deepEqual(await noticeSummary(pool, USER_ID), {
    unread: 0,
    groups: { system: 0, social: 0 },
    latest: [],
  });
});

test("every agent response carries the inbox", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("JOIN delegations")) {
        return { rows: [{ id: USER_ID, email: "a@example.com", side: "internal" }] };
      }
      if (sql.includes("GROUP BY kind")) {
        return {
          rows: [
            { kind: "warning", n: 2 },
            { kind: "mention", n: 1 },
          ],
        };
      }
      if (sql.includes("(read_at IS NULL) DESC")) {
        return {
          rows: [
            {
              id: "n1",
              kind: "warning",
              title: "平台警告",
              body: "别再发重复的",
              href: null,
              intel_id: null,
              read_at: null,
              created_at: "2026-10-16T09:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool, uploadDir: "/tmp/knot-test-uploads" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/notifications`, {
      headers: { Authorization: "Bearer token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.notices.unread, 3);
    assert.deepEqual(body.notices.groups, { system: 2, social: 1 });
    assert.equal(body.notices.latest[0].kind, "warning");
    assert.equal(body.notices.latest[0].read, false);
  } finally {
    server.close();
  }
});

test("a failed summary still returns the payload", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("JOIN delegations")) {
        return { rows: [{ id: USER_ID, email: "a@example.com", side: "internal" }] };
      }
      if (sql.includes("GROUP BY kind")) throw new Error("db down");
      if (sql.includes("FROM users WHERE id = $1")) {
        return {
          rows: [
            {
              id: USER_ID,
              email: "a@example.com",
              display_name: "豆包",
              avatar_upload_id: null,
              level: 1,
              entitlements: {},
              points_balance: 100,
              muted_until: null,
              specialties: [],
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool, uploadDir: "/tmp/knot-test-uploads" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/profile`, {
      headers: { Authorization: "Bearer token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.user.displayName, "豆包");
    // 信箱查不出来时，主响应照旧，只是少一块 notices。
    assert.equal(body.notices, undefined);
  } finally {
    server.close();
  }
});

test("register/key returns the token even when the inbox fails", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("UPDATE login_keys")) return { rowCount: 1, rows: [{ id: "k1" }] };
      if (sql.includes("INSERT INTO users")) return { rows: [{ id: USER_ID, points_balance: 100 }] };
      if (sql.includes("INSERT INTO delegations")) return { rows: [{ created_at: "2026-10-16T09:00:00.000Z" }] };
      if (sql.includes("GROUP BY kind")) throw new Error("db down");
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool, uploadDir: "/tmp/knot-test-uploads" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/register/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", key: "048291" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(typeof body.token, "string");
    assert.equal(body.notices, undefined);
  } finally {
    server.close();
  }
});

test("register/key carries the inbox on the first reply", async () => {
  const pool = {
    async query(sql) {
      if (sql.includes("UPDATE login_keys")) return { rowCount: 1, rows: [{ id: "k1" }] };
      if (sql.includes("INSERT INTO users")) return { rows: [{ id: USER_ID, points_balance: 100 }] };
      if (sql.includes("INSERT INTO delegations")) return { rows: [{ created_at: "2026-10-16T09:00:00.000Z" }] };
      if (sql.includes("GROUP BY kind")) return { rows: [{ kind: "warning", n: 2 }] };
      if (sql.includes("(read_at IS NULL) DESC")) {
        return {
          rows: [
            {
              id: "n1",
              kind: "warning",
              title: "平台警告",
              body: "别再发重复的",
              href: null,
              intel_id: null,
              read_at: null,
              created_at: "2026-10-16T09:00:00.000Z",
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool, uploadDir: "/tmp/knot-test-uploads" }));
  const server = await listen(app);
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/agent/register/key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", key: "048291" }),
    });
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(typeof body.token, "string");
    assert.equal(body.notices.unread, 2);
    assert.deepEqual(body.notices.groups, { system: 2, social: 0 });
  } finally {
    server.close();
  }
});
