// Agent 读到的记录要带公开地址：拼错一个分享链接就是 404，而 Agent 手里只有 id。
// 这里只走路由，不连库：令牌、信息流、附件、信箱四类查询各给一份固定结果。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { agentRouter } from "./agent.js";

const AGENT = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const INTEL = "27b21d25-26b2-4ad8-b24e-320377984013";
const ORIGIN = "https://cpswang.xknot.si";

function row() {
  return {
    id: INTEL,
    account_id: OWNER,
    actor: "personal_agent",
    body: "text",
    videos: [],
    links: {},
    content_hash: "a".repeat(64),
    detail: {},
    weight: 0,
    price: 0,
    category: "科技",
    kind: "post",
    verdict: "passed",
    reject_reason: null,
    is_public: true,
    created_at: new Date("2026-10-27T08:47:24.550Z"),
    updated_at: new Date("2026-10-27T08:48:32.944Z"),
    origin_id: null,
    version: 1,
    display_name: "cpswang-AI",
    avatar_upload_id: null,
    role: "agent",
    agent_type: null,
    starred: false,
    liked: false,
    tip_total: 0,
  };
}

function pool() {
  return {
    async query(sql) {
      if (sql.includes("token_hash = $1")) {
        return { rows: [{ id: AGENT, side: "external", display_name: "cpswang-AI", owner_id: OWNER, email: null }] };
      }
      if (sql.includes("FROM notifications")) return { rows: [] };
      if (sql.includes("INSERT INTO intel_reads")) return { rows: [] };
      if (sql.includes("FROM intel_files")) return { rows: [] };
      if (sql.includes("FROM intel i")) return { rows: [row()] };
      return { rows: [] };
    },
  };
}

async function listen(app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return server;
}

async function withAgent(origin, run) {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-agent-url-"));
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool: pool(), uploadDir: dir, publicWebOrigin: origin }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/agent`;
  try {
    const call = (pathname) =>
      fetch(`${base}${pathname}`, { headers: { Authorization: "Bearer token" } });
    return await run({ call });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test("the feed and a single read hand the Agent the record's public address", async () => {
  await withAgent(ORIGIN, async ({ call }) => {
    const feed = await call("/information");
    assert.equal(feed.status, 200);
    const { information } = await feed.json();
    assert.equal(information[0].url, `${ORIGIN}/discover?post=${INTEL}`);

    const single = await call(`/intel/${INTEL}`);
    assert.equal(single.status, 200);
    const { intel } = await single.json();
    assert.equal(intel.url, `${ORIGIN}/discover?post=${INTEL}`);
  });
});

test("without a public origin the record keeps its old shape", async () => {
  await withAgent("", async ({ call }) => {
    const { information } = await (await call("/information")).json();
    assert.equal(Object.hasOwn(information[0], "url"), false);
    const { intel } = await (await call(`/intel/${INTEL}`)).json();
    assert.equal(Object.hasOwn(intel, "url"), false);
  });
});
