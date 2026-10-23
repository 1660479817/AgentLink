import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyPolicy,
  availableRate,
  DOWN_HIDE_MS,
  DOWN_REMIND_MS,
  HEALTH_MAX_BYTES,
  isHttpsUrl,
  mergeHealth,
  NEVER_HIDE_MS,
  NEVER_REMIND_MS,
  probe,
  run,
} from "./check-health.mjs";

function jsonResponse(body, status = 200) {
  const text = body === undefined ? "not json" : JSON.stringify(body);
  return {
    status,
    // readLimited 先看 content-length，再按流读；假响应两者都给一份。
    headers: { get: () => String(Buffer.byteLength(text)) },
    text: async () => text,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
  };
}

// probe 只收地址；instance 身份从 options.id 传进来核对。
const PROBE_URL = "https://example.test/api/health";
const PROBE_ID = "wang";

test("a healthy instance is up and keeps the version", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: true, version: "0.2.0" }),
    clock: sequencer([0, 137]),
  });
  assert.equal(result.status, "up");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.latencyMs, 137);
  assert.equal(result.version, "0.2.0");
  assert.equal(result.error, null);
});

test("a slow but healthy instance is degraded", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: true }),
    clock: sequencer([0, 2500]),
  });
  assert.equal(result.status, "degraded");
});

test("3xx is a failure because redirects are not followed", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse(undefined, 302),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "redirect");
});

test("a 500 is down and carries the status", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse(undefined, 500),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "http_500");
});

test("ok !== true is a bad payload", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: false }),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "bad_payload");
});

test("a non-JSON body is a bad payload", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse(undefined),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "bad_payload");
});

test("an oversized health body is bounded instead of read into memory", async () => {
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: true, pad: "x".repeat(HEALTH_MAX_BYTES) }),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "too_large");
});

test("the instance may identify itself and must match the manifest", async () => {
  const match = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: true, instance: "wang" }),
    clock: sequencer([0, 10]),
  });
  assert.equal(match.status, "up");
  assert.equal(match.error, null);

  const mismatch = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: true, instance: "example" }),
    clock: sequencer([0, 10]),
  });
  assert.equal(mismatch.status, "down");
  assert.equal(mismatch.error, "instance_mismatch");
});

test("an instance that does not report an id is still judged by ok", async () => {
  // 协议里这一项是可选的：老实例不带 instance，不能被判成不健康。
  const result = await probe(PROBE_URL, {
    id: PROBE_ID,
    fetchImpl: async () => jsonResponse({ ok: true, service: "knot-backend" }),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "up");
});

test("only https is probed", async () => {
  assert.equal(isHttpsUrl("http://example.test/api/health"), false);
  assert.equal(isHttpsUrl("https://example.test/api/health"), true);
  assert.equal(isHttpsUrl("https://user:pass@example.test/api/health"), false);
  const result = await probe("http://example.test/api/health", { id: "x" });
  assert.equal(result.status, "unknown");
  assert.equal(result.error, "insecure_url");
});

test("an empty probe url stays unknown", async () => {
  const result = await probe(null, { id: "x" });
  assert.equal(result.status, "unknown");
  assert.equal(result.error, null);
});

test("a timeout is down", async () => {
  const fetchImpl = (_url, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  const result = await probe(PROBE_URL, { id: PROBE_ID, fetchImpl, timeoutMs: 5, clock: sequencer([0, 5]) });
  assert.equal(result.status, "down");
  assert.equal(result.error, "timeout");
});

test("merge accumulates checks and ok, and keeps lastOkAt on failure", () => {
  const first = mergeHealth(null, { status: "up", httpStatus: 200, latencyMs: 100, version: "1", error: null }, new Date("2026-10-19T00:00:00Z"));
  assert.equal(first.checks, 1);
  assert.equal(first.ok, 1);
  assert.equal(first.since, "2026-10-19T00:00:00.000Z");
  assert.equal(first.lastOkAt, "2026-10-19T00:00:00.000Z");

  const second = mergeHealth(first, { status: "down", httpStatus: 500, latencyMs: null, version: null, error: "http_500" }, new Date("2026-10-19T00:05:00Z"));
  assert.equal(second.checks, 2);
  assert.equal(second.ok, 1);
  assert.equal(second.status, "down");
  assert.equal(second.lastOkAt, "2026-10-19T00:00:00.000Z");
  assert.equal(second.since, "2026-10-19T00:00:00.000Z");
  assert.equal(availableRate(second), 0.5);
});

test("unknown does not count as a check", () => {
  const state = mergeHealth(null, { status: "unknown", httpStatus: null, latencyMs: null, version: null, error: null }, new Date("2026-10-19T00:00:00Z"));
  assert.equal(state.checks, 0);
  assert.equal(state.since, null);
  assert.equal(availableRate(state), null);
});

async function tempManifest(dir, instances) {
  const instancesPath = path.join(dir, "instances.json");
  await writeFile(instancesPath, JSON.stringify({ version: 4, instances }, null, 2));
  return instancesPath;
}

test("run writes var/health.json and merges the previous file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const outPath = path.join(dir, "var", "health.json");

  const instancesPath = await tempManifest(dir, [
    { id: "up", status: "active", url: "https://up.test" },
    { id: "down", status: "active", url: "https://down.test" },
    { id: "paused", status: "suspended", url: "https://paused.test" },
    { id: "off", status: "active" },
  ]);

  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://up.test")) return jsonResponse({ ok: true, version: "0.2.0" });
    return jsonResponse(undefined, 503);
  };

  const first = await run({
    instancesPath,
    outPath,
    fetchImpl,
    resolve: async () => ["1.2.3.4"],
    now: () => new Date("2026-10-19T01:00:00Z"),
  });
  assert.equal(first.instances.up.status, "up");
  assert.equal(first.instances.down.status, "down");
  assert.equal(first.instances.off.status, "unknown");
  assert.equal(first.instances.off.checks, 0);
  assert.equal(first.instances.paused.checks, 0);

  const second = await run({
    instancesPath,
    outPath,
    fetchImpl,
    resolve: async () => ["1.2.3.4"],
    now: () => new Date("2026-10-19T01:05:00Z"),
  });
  assert.equal(second.instances.up.checks, 2);
  assert.equal(second.instances.up.ok, 2);

  const saved = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(saved.checkedAt, "2026-10-19T01:05:00.000Z");
  assert.equal(saved.instances.up.status, "up");
  assert.equal(saved.instances.down.error, "http_503");
});

test("run derives the probe url from url (/api/health)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const outPath = path.join(dir, "var", "health.json");
  const instancesPath = await tempManifest(dir, [
    { id: "wang", status: "active", url: "https://wang.xknot.si" },
    // url 带了路径也收敛到站点根。
    { id: "example", status: "active", url: "https://example.xknot.si/some/page" },
  ]);

  const seen = [];
  await run({
    instancesPath,
    outPath,
    resolve: async () => ["1.2.3.4"],
    fetchImpl: async (url) => {
      seen.push(String(url));
      return jsonResponse({ ok: true });
    },
  });
  assert.deepEqual(seen.sort(), ["https://example.xknot.si/api/health", "https://wang.xknot.si/api/health"]);
});

test("run does not probe while the instance is pending", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const outPath = path.join(dir, "var", "health.json");
  const instancesPath = await tempManifest(dir, [
    { id: "example", status: "pending", url: "https://example.xknot.si", since: "2026-10-01" },
  ]);

  let called = false;
  const output = await run({
    instancesPath,
    outPath,
    now: () => new Date("2026-10-02T00:00:00Z"),
    resolve: async () => ["1.2.3.4"],
    fetchImpl: async () => {
      called = true;
      return jsonResponse({ ok: true });
    },
  });
  assert.equal(called, false, "pending 是等验收，不是断连，不发请求");
  assert.equal(output.instances.example.status, "unknown");
  assert.equal(output.instances.example.checks, 0);
});

test("run drops stale state when a subdomain is reissued", async () => {
  // 下架后用同一个子域重新签发：旧条目的 hiddenAt / downSince 不能跟过来。
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const outPath = path.join(dir, "var", "health.json");

  const instancesPath = await tempManifest(dir, [
    { id: "wang", status: "active", since: "2026-10-01", url: "https://wang.test" },
  ]);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(
    outPath,
    JSON.stringify({
      checkedAt: "2026-09-01T00:00:00.000Z",
      instances: {
        wang: {
          status: "down",
          downSince: "2026-08-20T00:00:00.000Z",
          hiddenAt: "2026-08-27T00:00:00.000Z",
          hiddenReason: "down_7d",
          manifestSince: "2025-01-01",
          checks: 40,
        },
      },
    })
  );

  const output = await run({
    instancesPath,
    outPath,
    fetchImpl: async () => jsonResponse(undefined, 503),
    resolve: async () => ["1.2.3.4"],
    now: () => new Date("2026-10-02T00:00:00Z"),
  });

  assert.equal(output.instances.wang.hiddenAt, null, "a reissued entry is not born hidden");
  assert.equal(output.instances.wang.hiddenReason, null);
  assert.equal(output.instances.wang.downSince, "2026-10-02T00:00:00.000Z");
  assert.equal(output.instances.wang.checks, 1, "counters restart from zero");
  assert.equal(output.instances.wang.manifestSince, "2026-10-01");
});

test("run probes concurrently and keeps manifest order", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const outPath = path.join(dir, "var", "health.json");

  const ids = ["a", "b", "c", "d", "e"];
  const instancesPath = await tempManifest(
    dir,
    ids.map((id) => ({ id, status: "active", url: `https://${id}.test` }))
  );
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return jsonResponse({ ok: true });
  };

  const output = await run({
    instancesPath,
    outPath,
    fetchImpl,
    resolve: async () => ["1.2.3.4"],
    concurrency: 3,
  });
  assert.deepEqual(Object.keys(output.instances), ids);
  assert.equal(peak, 3);
});

test("run refuses an instance url that resolves to a private address", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const outPath = path.join(dir, "var", "health.json");
  const instancesPath = await tempManifest(dir, [
    { id: "inside", status: "active", url: "https://inside.test" },
  ]);

  let called = false;
  const fetchImpl = async () => {
    called = true;
    return jsonResponse({ ok: true });
  };
  const output = await run({
    instancesPath,
    outPath,
    fetchImpl,
    resolve: async () => ["192.168.3.91"],
  });
  assert.equal(output.instances.inside.status, "down");
  assert.equal(output.instances.inside.error, "private_address");
  assert.equal(called, false);
});

function sequencer(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

// ---- 连续断连：24 小时提醒、7 天暂时隐藏、恢复自动回来 ----

const DOWN_RESULT = { status: "down", httpStatus: 503, latencyMs: null, version: null, error: "http_503" };

function downAt(iso) {
  return mergeHealth(
    null,
    DOWN_RESULT,
    new Date(iso)
  );
}

test("policy: 24 hours down sends one reminder, not two", () => {
  const instance = { id: "wang", status: "active", url: "https://wang.test" };
  const start = "2026-10-01T00:00:00.000Z";
  const state = downAt(start);

  const early = applyPolicy(instance, state, new Date(Date.parse(start) + 3600_000));
  assert.deepEqual(early.notices, [], "one hour is not a notice");
  assert.equal(early.state.hiddenAt, null);

  const reminded = applyPolicy(instance, early.state, new Date(Date.parse(start) + DOWN_REMIND_MS + 1000));
  assert.deepEqual(reminded.notices.map((notice) => notice.kind), ["down_24h"]);

  const again = applyPolicy(instance, reminded.state, new Date(Date.parse(start) + DOWN_REMIND_MS + 7200_000));
  assert.deepEqual(again.notices, [], "the reminder is recorded, not repeated");
});

test("policy: 7 days down hides the entry once, recovery clears it", () => {
  const instance = { id: "wang", status: "active", url: "https://wang.test" };
  const start = "2026-10-01T00:00:00.000Z";
  const before = downAt(start);

  const hidden = applyPolicy(instance, before, new Date(Date.parse(start) + DOWN_HIDE_MS + 1000));
  assert.deepEqual(hidden.notices.map((notice) => notice.kind), ["down_7d"]);
  assert.equal(hidden.state.hiddenReason, "down_7d");
  assert.ok(hidden.state.hiddenAt);

  const stillHidden = applyPolicy(instance, hidden.state, new Date(Date.parse(start) + DOWN_HIDE_MS + 86400_000));
  assert.deepEqual(stillHidden.notices, [], "hiding is recorded, not repeated");

  const recovered = mergeHealth(
    stillHidden.state,
    { status: "up", httpStatus: 200, latencyMs: 120, version: "0.3.0", error: null },
    new Date(Date.parse(start) + DOWN_HIDE_MS + 86400_000)
  );
  const after = applyPolicy(instance, recovered, new Date(Date.parse(start) + DOWN_HIDE_MS + 86400_000));
  assert.equal(after.state.hiddenAt, null);
  assert.equal(after.state.downSince, null);
});

test("policy: never connected is measured from since, and does not hide before 30 days", () => {
  const instance = { id: "new", status: "active", url: "https://new.test", since: "2026-09-20" };
  const state = mergeHealth(null, { status: "unknown", httpStatus: null, latencyMs: null, version: null, error: null });
  const never = { probed: false };

  const day13 = applyPolicy(instance, state, new Date("2026-10-03T00:00:00Z"), never);
  assert.deepEqual(day13.notices, []);

  const day15 = applyPolicy(instance, state, new Date("2026-10-05T00:00:00Z"), never);
  assert.deepEqual(day15.notices.map((notice) => notice.kind), ["never_14d"]);
  assert.equal(day15.state.hiddenAt, null);

  const day31 = applyPolicy(instance, day15.state, new Date("2026-10-21T00:00:00Z"), never);
  assert.deepEqual(day31.notices.map((notice) => notice.kind), ["never_30d"]);
  assert.equal(day31.state.hiddenReason, "never_30d");
  assert.ok(NEVER_REMIND_MS < NEVER_HIDE_MS);
});

test("policy: an entry that is being probed is not treated as never-connected", () => {
  // 已接通但探不到 → 走 down 的 24 小时 / 7 天，不是 never 的 14 天 / 30 天。
  const instance = { id: "wang", status: "active", url: "https://wang.test", since: "2026-01-01" };
  const state = mergeHealth(null, { status: "unknown", httpStatus: null, latencyMs: null, version: null, error: null });
  const result = applyPolicy(instance, state, new Date("2026-10-21T00:00:00Z"), { probed: true });
  assert.deepEqual(result.notices, []);
  assert.equal(result.state.hiddenAt, null);
});

test("policy: suspended entries are left alone", () => {
  const instance = { id: "old", status: "suspended", url: "https://old.test" };
  const state = downAt("2026-10-01T00:00:00.000Z");
  const result = applyPolicy(instance, { ...state, hiddenAt: "2026-10-08T00:00:00.000Z" }, new Date("2026-12-01T00:00:00Z"));
  assert.deepEqual(result.notices, []);
  assert.equal(result.state.hiddenAt, null);
});
