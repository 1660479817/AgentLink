import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { availableRate, isHttpsUrl, mergeHealth, probe, run } from "./check-health.mjs";

function jsonResponse(body, status = 200) {
  return {
    status,
    json: async () => {
      if (body === undefined) throw new Error("not json");
      return body;
    },
  };
}

const INSTANCE = { id: "wang", healthUrl: "https://example.test/api/health" };

test("a healthy instance is up and keeps the version", async () => {
  const result = await probe(INSTANCE, {
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
  const result = await probe(INSTANCE, {
    fetchImpl: async () => jsonResponse({ ok: true }),
    clock: sequencer([0, 2500]),
  });
  assert.equal(result.status, "degraded");
});

test("3xx is a failure because redirects are not followed", async () => {
  const result = await probe(INSTANCE, {
    fetchImpl: async () => jsonResponse(undefined, 302),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "redirect");
});

test("a 500 is down and carries the status", async () => {
  const result = await probe(INSTANCE, {
    fetchImpl: async () => jsonResponse(undefined, 500),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "http_500");
});

test("ok !== true is a bad payload", async () => {
  const result = await probe(INSTANCE, {
    fetchImpl: async () => jsonResponse({ ok: false }),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "bad_payload");
});

test("a non-JSON body is a bad payload", async () => {
  const result = await probe(INSTANCE, {
    fetchImpl: async () => jsonResponse(undefined),
    clock: sequencer([0, 10]),
  });
  assert.equal(result.status, "down");
  assert.equal(result.error, "bad_payload");
});

test("only https is probed", async () => {
  assert.equal(isHttpsUrl("http://example.test/api/health"), false);
  assert.equal(isHttpsUrl("https://example.test/api/health"), true);
  assert.equal(isHttpsUrl("https://user:pass@example.test/api/health"), false);
  const result = await probe({ id: "x", healthUrl: "http://example.test/api/health" });
  assert.equal(result.status, "unknown");
  assert.equal(result.error, "insecure_url");
});

test("no healthUrl stays unknown", async () => {
  const result = await probe({ id: "x", healthUrl: null });
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
  const result = await probe(INSTANCE, { fetchImpl, timeoutMs: 5, clock: sequencer([0, 5]) });
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

test("run writes var/health.json and merges the previous file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const instancesPath = path.join(dir, "instances.json");
  const outPath = path.join(dir, "var", "health.json");

  await writeFile(
    instancesPath,
    JSON.stringify({
      version: 2,
      instances: [
        { id: "up", status: "active", healthUrl: "https://up.test/api/health" },
        { id: "down", status: "active", healthUrl: "https://down.test/api/health" },
        { id: "paused", status: "suspended", healthUrl: "https://paused.test/api/health" },
        { id: "off", status: "active", healthUrl: null },
      ],
    })
  );

  const fetchImpl = async (url) => {
    if (String(url).startsWith("https://up.test")) return jsonResponse({ ok: true, version: "0.2.0" });
    return jsonResponse(undefined, 503);
  };

  const first = await run({ instancesPath, outPath, fetchImpl, now: () => new Date("2026-10-19T01:00:00Z") });
  assert.equal(first.instances.up.status, "up");
  assert.equal(first.instances.down.status, "down");
  assert.equal(first.instances.off.status, "unknown");
  assert.equal(first.instances.off.checks, 0);
  assert.equal(first.instances.paused.checks, 0);

  const second = await run({ instancesPath, outPath, fetchImpl, now: () => new Date("2026-10-19T01:05:00Z") });
  assert.equal(second.instances.up.checks, 2);
  assert.equal(second.instances.up.ok, 2);

  const saved = JSON.parse(await readFile(outPath, "utf8"));
  assert.equal(saved.checkedAt, "2026-10-19T01:05:00.000Z");
  assert.equal(saved.instances.up.status, "up");
  assert.equal(saved.instances.down.error, "http_503");
});

test("run probes concurrently and keeps manifest order", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-health-"));
  const instancesPath = path.join(dir, "instances.json");
  const outPath = path.join(dir, "var", "health.json");

  const ids = ["a", "b", "c", "d", "e"];
  await writeFile(
    instancesPath,
    JSON.stringify({
      instances: ids.map((id) => ({ id, status: "active", healthUrl: `https://${id}.test/api/health` })),
    })
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

  const output = await run({ instancesPath, outPath, fetchImpl, concurrency: 3 });
  assert.deepEqual(Object.keys(output.instances), ids);
  assert.equal(peak, 3);
});

function sequencer(values) {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}
