import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { composeStatus, refreshStatus, summarizeTraffic } from "./node-status.mjs";

const instances = [{ id: "wang", url: "https://wang.xknot.si", status: "active", tier: "paid", since: "2026-10-19" }];
const federation = {
  members: [{ id: "wang", host: "wang.xknot.si", tunnel: { account: "knot-tunnel", port: 18080 } }],
};

test("composeStatus: 把健康、隧道、位置、流量并成一个节点", () => {
  const status = composeStatus({
    instances,
    federation,
    health: {
      checkedAt: "2026-10-22T01:00:00.000Z",
      instances: {
        wang: {
          status: "up",
          latencyMs: 118,
          version: "0.4.1",
          error: null,
          lastOkAt: "2026-10-22T00:55:00.000Z",
          downSince: null,
          hiddenAt: null,
        },
      },
    },
    peers: { collectedAt: "2026-10-22T00:59:00.000Z", peers: { wang: { ip: "203.0.113.7", account: "knot-tunnel" } } },
    locations: { locations: { wang: { country: "CN", at: "2026-10-21T00:00:00.000Z", source: "tunnel" } } },
    traffic: {
      wang: {
        id: "wang",
        updatedAt: "2026-10-22T00:00:00.000Z",
        days: [
          { date: "2026-10-21", requests: 812, bytes: 91827364 },
          { date: "2026-10-20", requests: 700, bytes: 80000000 },
        ],
      },
    },
    generatedAt: "2026-10-22T01:01:00.000Z",
  });

  const node = status.nodes.wang;
  assert.equal(node.host, "wang.xknot.si");
  assert.equal(node.manifest.status, "active");
  assert.equal(node.probe.status, "up");
  assert.equal(node.probe.checkedAt, "2026-10-22T01:00:00.000Z");
  assert.equal(node.tunnel.connected, true);
  assert.equal(node.tunnel.port, 18080);
  assert.equal(node.location.country, "CN");
  assert.deepEqual(node.traffic, {
    date: "2026-10-21",
    requests: 812,
    bytes: 91827364,
    updatedAt: "2026-10-22T00:00:00.000Z",
  });

  // 出口 IP 只留在 peers.json，聚合产物里不出现。
  assert.doesNotMatch(JSON.stringify(status), /203\.0\.113\.7/);
});

test("composeStatus: 采集缺失时字段为 null / false，不编数据", () => {
  const status = composeStatus({ instances, federation });
  const node = status.nodes.wang;
  assert.equal(node.probe, null);
  assert.equal(node.tunnel.connected, false);
  assert.equal(node.tunnel.checkedAt, null);
  assert.equal(node.tunnel.port, 18080);
  assert.equal(node.location, null);
  assert.equal(node.traffic, null);
});

test("summarizeTraffic: 只取最近一天；没有 days 就是 null", () => {
  assert.equal(summarizeTraffic(null), null);
  assert.equal(summarizeTraffic({ days: [] }), null);
  assert.deepEqual(
    summarizeTraffic({ updatedAt: "2026-10-22T00:00:00.000Z", days: [{ date: "2026-10-21", requests: 3, bytes: 0 }] }),
    { date: "2026-10-21", requests: 3, bytes: 0, updatedAt: "2026-10-22T00:00:00.000Z" }
  );
});

test("refreshStatus: 读各源文件写 status.json，缺文件只少字段", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-status-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const instancesPath = path.join(dir, "instances.json");
  const federationPath = path.join(dir, "federation.json");
  await writeFile(instancesPath, JSON.stringify({ instances }));
  await writeFile(federationPath, JSON.stringify(federation));
  await mkdir(path.join(dir, "geoip"), { recursive: true });
  await mkdir(path.join(dir, "traffic"), { recursive: true });
  await writeFile(
    path.join(dir, "health.json"),
    JSON.stringify({ checkedAt: "2026-10-22T01:00:00.000Z", instances: { wang: { status: "down", error: "timeout" } } })
  );
  await writeFile(
    path.join(dir, "traffic", "wang.json"),
    JSON.stringify({ id: "wang", days: [{ date: "2026-10-21", requests: 4, bytes: 40 }] })
  );

  const result = await refreshStatus({
    dataDir: dir,
    instancesPath,
    federationPath,
    now: () => new Date("2026-10-22T02:00:00Z"),
  });
  assert.equal(result.generatedAt, "2026-10-22T02:00:00.000Z");
  assert.equal(result.nodes.wang.probe.status, "down");
  assert.equal(result.nodes.wang.traffic.requests, 4);

  const saved = JSON.parse(await readFile(path.join(dir, "status.json"), "utf8"));
  assert.equal(saved.nodes.wang.probe.error, "timeout");
  // peers.json / locations.json 都不在：隧道与位置留空，不影响其余字段。
  assert.equal(saved.nodes.wang.tunnel.connected, false);
  assert.equal(saved.nodes.wang.location, null);
});
