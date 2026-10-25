// 外网访问面板的接口：一次同步要把「状态、过程、自动完成的部分」一起给出来。
//
// 这里刻意不触发重启：预先把 tunnel.env 与 xknot.env 写成和同步结果一模一样，
// 内容没变就不会 schedule 重启，测试也就不会去碰本机真正的常驻单元。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

import { createProfileStore } from "../profile.js";
import { applyManagedBlock, renderManagedBlock, tunnelEnvPath } from "../tunnel.js";
import { joinEnvPath, joinValues, writeJoinEnv } from "../issued.js";
import { adminRouter } from "./admin.js";

const TOKEN = "test-token";
const HUB = "https://hub.example";
const SITE = {
  name: "北港",
  tagline: "北海沿岸的慢阅读。",
  owner: "Lin",
  contact: "lin@example.com",
};

const realFetch = globalThis.fetch;

function stubHub(handler) {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (href.startsWith(HUB)) return handler(href, init);
    return realFetch(url, init);
  };
}

function hubReply(status, body) {
  return { status, text: async () => JSON.stringify(body), json: async () => body };
}

// 把「上一轮已经写好的文件」放在盘上：同步时内容一致 → 不重启。
async function seedFiles(dir, { application, handoff }) {
  if (handoff) {
    await applyManagedBlock({
      file: tunnelEnvPath(dir),
      block: renderManagedBlock({ ...handoff, localPort: 8080 }),
    });
  }
  if (application) {
    writeFileSync(
      path.join(dir, "join.json"),
      `${JSON.stringify({ formatVersion: 1, application }, null, 2)}\n`,
      { mode: 0o600 }
    );
  }
  return dir;
}

async function withAccess(fn, { site = SITE } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-access-"));
  const store = createProfileStore({ file: path.join(dir, "profile.json") });
  if (site) await store.save({ site });
  // 预先放一把公钥：补交那一步不该去调本机的 ssh-keygen。
  writeFileSync(path.join(dir, "tunnel_ed25519.pub"), "ssh-ed25519 AAAAtest knot-tunnel\n");

  const previous = process.env.KNOT_HUB_ORIGIN;
  process.env.KNOT_HUB_ORIGIN = HUB;

  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin",
    adminRouter({ pool: {}, token: TOKEN, profile: store, publicWebOrigin: "https://knot.example", port: 8080 })
  );
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const call = (pathname, options = {}) =>
    realFetch(`${base}${pathname}`, {
      ...options,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(options.headers || {}) },
    });

  try {
    return await fn({ call, dir });
  } finally {
    globalThis.fetch = realFetch;
    if (previous == null) delete process.env.KNOT_HUB_ORIGIN;
    else process.env.KNOT_HUB_ORIGIN = previous;
    await new Promise((resolve) => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

test("没申请过：同步回「未接入」，并给出申请这个动作", async () => {
  await withAccess(async ({ call }) => {
    stubHub(async () => {
      throw new Error("不该在中枢上请求任何东西");
    });
    const response = await call("/access/sync", { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.access.state, "not_joined");
    assert.equal(data.access.action, "apply");
    assert.deepEqual(data.access.missing, []);
    assert.equal(data.local.tunnelConfigured, false);
    // 申请之前不必去问中枢，也不能把「问不到」当成失败。
    assert.equal(data.access.hubError, "");
  });
});

test("档案缺项：仍然给申请按钮，但把缺的字段带出来", async () => {
  await withAccess(
    async ({ call }) => {
      const response = await call("/access/sync", { method: "POST", body: "{}" });
      const data = await response.json();
      assert.equal(data.access.action, "apply");
      assert.equal(data.access.reason, "profile_incomplete");
      assert.deepEqual(data.access.missing.sort(), ["email", "intro", "operator"]);
    },
    { site: { name: "北港" } }
  );
});

test("中枢给出的交接参数会写进 tunnel.env，并反映在过程里", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  const handoff = { account: "knot-tunnel-nordhavn", host: "entry.example", port: 18090 };

  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application, handoff });
    stubHub(async () =>
      hubReply(200, {
        application: { id: "XK-1", status: "approved", subdomain: "nordhavn" },
        issued: { id: "nordhavn", url: "https://nordhavn.xknot.si", tier: "free", since: "2026-10-20", status: "pending" },
        run: { state: "awaiting_tunnel", steps: [{ id: "tls", state: "done" }], lastError: null },
        handoff,
      })
    );

    const response = await call("/access/sync", { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.access.state, "awaiting_tunnel");
    assert.equal(data.access.action, "connect");
    assert.equal(data.local.tunnelConfigured, true);
    assert.equal(data.access.steps.find((step) => step.id === "tunnel").state, "done");
    assert.equal(data.access.steps.find((step) => step.id === "probe").state, "running");
  });
});

test("中枢连不上：回 200 加失败原因，让面板给重试而不是弹红条", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application });
    stubHub(async () => {
      throw new Error("ECONNREFUSED");
    });
    const response = await call("/access/sync", { method: "POST", body: "{}" });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.access.state, "failed");
    assert.equal(data.access.reason, "hub_unreachable");
    assert.equal(data.access.action, "retry");
    assert.equal(data.access.hubError, "unreachable");
  });
});

test("中枢那边已经没有这张单：给「重新申请」，不让人反复重试", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application });
    stubHub(async () => hubReply(404, { error: "not_found" }));
    const response = await call("/access/sync", { method: "POST", body: "{}" });
    const data = await response.json();
    assert.equal(data.access.state, "failed");
    assert.equal(data.access.reason, "application_closed");
    assert.equal(data.access.action, "reapply");
  });
});

test("撤回过的申请：状态从进度里读出来，动作是重新申请", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application });
    stubHub(async () =>
      hubReply(200, {
        application: { id: "XK-1", status: "withdrawn" },
        issued: null,
        run: { state: "failed", steps: [], lastError: "application_closed" },
        handoff: null,
      })
    );
    const response = await call("/access/sync", { method: "POST", body: "{}" });
    const data = await response.json();
    assert.equal(data.access.state, "failed");
    assert.equal(data.access.reason, "application_closed");
    assert.equal(data.access.action, "reapply");
  });
});

test("只有点重试才补交公钥；轮询不碰中枢的公钥接口", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application });
    const seen = [];
    stubHub(async (url, init) => {
      seen.push({ url, method: init?.method });
      return hubReply(200, {
        application: { id: "XK-1", status: "approved" },
        issued: null,
        run: { state: "provisioning", steps: [{ id: "sshd", state: "pending", error: "public_key_missing" }], lastError: null },
        handoff: null,
      });
    });

    await call("/access/sync", { method: "POST", body: "{}" });
    assert.equal(seen.some((item) => item.url.endsWith("/public-key")), false);
    assert.equal(true, seen.some((item) => item.url.endsWith("/progress")));

    seen.length = 0;
    const retried = await call("/access/sync", { method: "POST", body: JSON.stringify({ deliverKey: true }) });
    const data = await retried.json();
    assert.equal(seen.some((item) => item.url.endsWith("/public-key") && item.method === "POST"), true);
    assert.deepEqual(data.key, { delivered: true, created: false, error: "" });
    // 中枢报的是公钥缺失，所以这一次补交是有意义的。
    assert.equal(data.access.keyNeeded, true);
    assert.equal(data.access.steps.find((step) => step.id === "sshd").state, "retrying");
  });
});

test("验收通过：接入件写到站点目录，状态变成已上线（等重启生效）", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  const issued = { id: "nordhavn", url: "https://nordhavn.xknot.si", tier: "free", since: "2026-10-20", status: "active" };
  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application });
    // 预写一份一模一样的接入件：内容没变就不会 schedule 重启。
    await writeJoinEnv({
      file: joinEnvPath(dir),
      values: joinValues({ issued, hubOrigin: HUB }),
    });
    stubHub(async () =>
      hubReply(200, {
        application: { id: "XK-1", status: "approved", subdomain: "nordhavn" },
        issued,
        run: { state: "active", steps: [{ id: "tls", state: "done" }], lastError: null },
        handoff: { account: "knot-tunnel-nordhavn", host: "entry.example", port: 18090 },
      })
    );

    const response = await call("/access/sync", { method: "POST", body: "{}" });
    const data = await response.json();
    assert.equal(data.local.joinWritten, true);
    // 进程里还没有签发区（测试没重启 Backend），所以是「已验收、等重启」。
    assert.equal(data.access.state, "active");
    assert.equal(data.access.reason, "join_pending");
    assert.equal(data.access.action, "retry");
    assert.equal(data.access.steps.find((step) => step.id === "join").state, "done");
  });
});

test("中枢给了参数但这一侧没有私钥：不写隧道配置，把缺的那一步报出来", async () => {
  const application = { id: "XK-1", caseUrl: `${HUB}/case/abcdef12`, status: "approved", submittedAt: "2026-10-20T08:00:00Z" };
  const handoff = { account: "knot-tunnel-nordhavn", host: "entry.example", port: 18090 };

  await withAccess(async ({ call, dir }) => {
    await seedFiles(dir, { application });
    // 私钥是申请时那把公钥的配对件：没有它，写进配置也连不上。
    rmSync(path.join(dir, "tunnel_ed25519.pub"));
    stubHub(async () =>
      hubReply(200, {
        application: { id: "XK-1", status: "approved", subdomain: "nordhavn" },
        issued: { id: "nordhavn", url: "https://nordhavn.xknot.si", tier: "free", since: "2026-10-20", status: "pending" },
        run: { state: "awaiting_tunnel", steps: [{ id: "tls", state: "done" }], lastError: null },
        handoff,
      })
    );

    const response = await call("/access/sync", { method: "POST", body: "{}" });
    const data = await response.json();
    assert.equal(data.local.error, "tunnel_key_missing");
    assert.equal(data.local.tunnelConfigured, false);
    assert.equal(data.access.action, "connect");
    assert.equal(data.access.steps.find((step) => step.id === "tunnel").error, "tunnel_key_missing");
  });
});

test("旧的 /xknot/progress 仍然可用，形状不变", async () => {
  await withAccess(async ({ call }) => {
    stubHub(async () => {
      throw new Error("没有申请就不该请求中枢");
    });
    const response = await call("/xknot/progress");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.application, null);
    assert.equal(data.run, null);
    assert.equal(data.handoff, null);
    // 新加的字段只是附加，不影响既有读法。
    assert.equal(data.access.state, "not_joined");
  });
});
