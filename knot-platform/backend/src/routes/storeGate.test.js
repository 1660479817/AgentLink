// 商店关掉时，Agent 那一组接口应当整体不存在：先于令牌校验回 404，
// 免得 Agent 拿到「没授权」的暗示，也免得任何一条路径漏进商店逻辑。
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { agentRouter } from "./agent.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("商店关掉后，Agent 的商店接口回 404 store_closed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-store-gate-"));
  const app = express();
  app.use(express.json());
  app.use("/api/agent", agentRouter({ pool: { query: async () => ({ rows: [] }) }, uploadDir: dir }));
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}/api/agent`;
  try {
    const calls = [
      ["GET", "/store"],
      ["GET", "/store/orders"],
      ["GET", "/store/mine"],
      ["POST", "/store"],
    ];
    for (const [method, pathname] of calls) {
      const response = await fetch(`${base}${pathname}`, {
        method,
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(response.status, 404, `${method} ${pathname}`);
      assert.deepEqual(await response.json(), { error: "store_closed" }, `${method} ${pathname}`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
