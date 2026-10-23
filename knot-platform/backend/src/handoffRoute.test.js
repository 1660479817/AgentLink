import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { createHandoff } from "./handoff.js";
import { adminRouter } from "./routes/admin.js";

// 只验「票据兑换 + 凭据过关」这两步，其余的 /api/admin 端点在这个文件里不用真库：
// 中间件放行之后随便挑一个不碰库的端点（/profile）当探针。

const TOKEN = "test-admin-token-0123456789abcdef";

async function withAdminApi(handoff, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRouter({ pool: null, token: TOKEN, handoff }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function claim(base, ticket) {
  return fetch(`${base}/handoff/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
}

function probe(base, authorization) {
  return fetch(`${base}/profile`, { headers: authorization ? { Authorization: authorization } : {} });
}

test("票据兑换后，凭据能让 /api/admin 放行；同一枚票据不能再用", async () => {
  const handoff = createHandoff({ token: TOKEN });
  await withAdminApi(handoff, async (base) => {
    assert.equal((await probe(base)).status, 401);

    const { ticket } = handoff.issue();
    const response = await claim(base, ticket);
    assert.equal(response.status, 200);
    const { credential, expiresAt } = await response.json();
    assert.match(credential, /^kas1\./);
    assert.ok(Date.parse(expiresAt) > Date.now());

    assert.notEqual((await probe(base, `Bearer ${credential}`)).status, 401);
    assert.equal((await claim(base, ticket)).status, 401);
  });
});

test("主令牌照旧可用，乱写的凭据一律 401", async () => {
  const handoff = createHandoff({ token: TOKEN });
  await withAdminApi(handoff, async (base) => {
    assert.notEqual((await probe(base, `Bearer ${TOKEN}`)).status, 401);
    assert.equal((await probe(base, "Bearer kas1.9999999999999.forged")).status, 401);
    assert.equal((await probe(base, "Bearer nope")).status, 401);
  });
});

test("票据过期或没带票据时，兑换返回 401 而不是 500", async () => {
  let at = 1_700_000_000_000;
  const handoff = createHandoff({ token: TOKEN, now: () => at });
  await withAdminApi(handoff, async (base) => {
    assert.equal((await claim(base, "")).status, 401);
    const { ticket } = handoff.issue();
    at += 5 * 60 * 1000 + 1;
    assert.equal((await claim(base, ticket)).status, 401);
  });
});

test("没配令牌时兑换不起作用，也不用假装成功", async () => {
  const handoff = createHandoff({ token: "" });
  await withAdminApi(handoff, async (base) => {
    const response = await claim(base, "t1.1.x.y");
    assert.equal(response.status, 503);
  });
});
