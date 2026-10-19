// 中枢健康探测：读 instances.json，逐个探 healthUrl，写 var/health.json。
//
// 只用外部 HTTP，不读实例的库，不带任何凭据。判定见 docs/FEDERATION.md 第 5 节。
//
// 用法：
//   node xknot.si/ops/check-health.mjs
//   node xknot.si/ops/check-health.mjs --instances ./instances.json --out ./var/health.json

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEGRADED_MS = 2000;

export function isHttpsUrl(raw) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    return Boolean(url.host);
  } catch {
    return false;
  }
}

function unknownState(previous) {
  const prev = previous || {};
  return {
    status: "unknown",
    httpStatus: null,
    latencyMs: null,
    version: prev.version ?? null,
    lastOkAt: prev.lastOkAt ?? null,
    since: prev.since ?? null,
    checks: Number(prev.checks) || 0,
    ok: Number(prev.ok) || 0,
    error: null,
  };
}

// 单个实例探一次。返回 { status, httpStatus, latencyMs, version, error }。
export async function probe(instance, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    degradedMs = DEGRADED_MS,
    clock = () => performance.now(),
  } = options;

  const url = instance?.healthUrl;
  if (!url) return unknownStateResult();
  if (!isHttpsUrl(url)) return { ...unknownStateResult(), error: "insecure_url" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = clock();

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    const latencyMs = Math.round(clock() - started);

    // 不跟随重定向：3xx 视为失败，避免被指到别处。
    if (response.status >= 300 && response.status < 400) {
      return { status: "down", httpStatus: response.status, latencyMs, version: null, error: "redirect" };
    }
    if (response.status !== 200) {
      return { status: "down", httpStatus: response.status, latencyMs, version: null, error: `http_${response.status}` };
    }

    let body = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    if (!body || body.ok !== true) {
      return { status: "down", httpStatus: 200, latencyMs, version: null, error: "bad_payload" };
    }

    return {
      status: latencyMs > degradedMs ? "degraded" : "up",
      httpStatus: 200,
      latencyMs,
      version: typeof body.version === "string" ? body.version : null,
      error: null,
    };
  } catch (error) {
    const latencyMs = Math.round(clock() - started);
    const aborted = error?.name === "AbortError";
    return { status: "down", httpStatus: null, latencyMs, version: null, error: aborted ? "timeout" : "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

function unknownStateResult() {
  return { status: "unknown", httpStatus: null, latencyMs: null, version: null, error: null };
}

// 把一次探测并进上一次的状态：累计 checks / ok，成功时刷新 lastOkAt，since 只在第一次写下。
export function mergeHealth(previous, result, now = new Date()) {
  const at = now.toISOString();
  const prev = previous || {};
  const healthy = result.status === "up" || result.status === "degraded";
  const countable = result.status !== "unknown";

  return {
    status: result.status,
    httpStatus: result.httpStatus ?? null,
    latencyMs: result.latencyMs ?? null,
    version: result.version ?? null,
    lastOkAt: healthy ? at : prev.lastOkAt ?? null,
    since: prev.since ?? (countable ? at : null),
    checks: (Number(prev.checks) || 0) + (countable ? 1 : 0),
    ok: (Number(prev.ok) || 0) + (healthy ? 1 : 0),
    error: result.error ?? null,
  };
}

export function availableRate(state) {
  const checks = Number(state?.checks) || 0;
  if (!checks) return null;
  return (Number(state.ok) || 0) / checks;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

export async function run(options = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const {
    instancesPath = path.join(here, "..", "instances.json"),
    outPath = path.join(here, "..", "var", "health.json"),
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    degradedMs = DEGRADED_MS,
    concurrency = 8,
    now = () => new Date(),
    log = () => {},
  } = options;

  const manifest = await readJson(instancesPath, null);
  if (!manifest || !Array.isArray(manifest.instances)) {
    throw new Error(`cannot read instances: ${instancesPath}`);
  }

  const previous = await readJson(outPath, { instances: {} });
  const at = now();

  // 逐个实例并发探测，同时最多跑 concurrency 个，结果按清单顺序返回。
  const entries = await mapWithConcurrency(manifest.instances, concurrency, async (instance) => {
    const before = previous?.instances?.[instance?.id] || null;
    // 暂停或已退役的条目不探，保留上一次的结果。
    if (instance?.status && instance.status !== "active") {
      return [instance.id, before ?? unknownState(before)];
    }
    const result = await probe(instance, { fetchImpl, timeoutMs, degradedMs });
    return [instance.id, mergeHealth(before, result, at)];
  });

  for (const [id, state] of entries) {
    log(`${id}: ${state.status}${state.error ? ` (${state.error})` : ""}`);
  }

  const output = { checkedAt: at.toISOString(), instances: Object.fromEntries(entries) };
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(output, null, 2)}\n`);
  await rename(tmp, outPath);
  return output;
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === "--instances") args.instancesPath = argv[++i];
    else if (name === "--out") args.outPath = argv[++i];
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  run({ ...args, log: (line) => console.log(line) })
    .then((output) => {
      for (const [id, state] of Object.entries(output.instances)) {
        const latency = state.latencyMs == null ? "-" : `${state.latencyMs}ms`;
        const error = state.error ? ` ${state.error}` : "";
        console.log(`${id.padEnd(16)} ${state.status.padEnd(9)} ${latency.padEnd(8)}${error}`);
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
