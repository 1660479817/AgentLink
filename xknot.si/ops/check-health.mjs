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

import { assertPublicUrl, resolveHosts } from "./fetch-guard.mjs";

export const DEFAULT_TIMEOUT_MS = 5000;
export const DEGRADED_MS = 2000;

// 断连的两道线。24 小时提醒，7 天从门户暂时关闭（清单条目不动）。
export const DOWN_REMIND_MS = 24 * 3600_000;
export const DOWN_HIDE_MS = 7 * 24 * 3600_000;

// 从未接通是另一条规则：以清单的 since 起算，14 天提醒，30 天暂时关闭。
export const NEVER_REMIND_MS = 14 * 24 * 3600_000;
export const NEVER_HIDE_MS = 30 * 24 * 3600_000;

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
    downSince: null,
    notified: prev.notified && typeof prev.notified === "object" ? { ...prev.notified } : {},
    hiddenAt: prev.hiddenAt ?? null,
    hiddenReason: prev.hiddenReason ?? null,
    manifestSince: prev.manifestSince ?? null,
  };
}

// 单个实例探一次。返回 { status, httpStatus, latencyMs, version, error }。
export async function probe(instance, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    degradedMs = DEGRADED_MS,
    clock = () => performance.now(),
    resolve = null,
  } = options;

  const url = instance?.healthUrl;
  if (!url) return unknownStateResult();
  if (!isHttpsUrl(url)) return { ...unknownStateResult(), error: "insecure_url" };

  // 构建时用 resolve 做 DNS 后检查，拒绝回环、私有网段与云元数据地址；
  // 单元测试可以不传，只验证 HTTP 语义。
  if (resolve) {
    try {
      await assertPublicUrl(url, { resolve });
    } catch (error) {
      return { status: "down", httpStatus: null, latencyMs: null, version: null, error: error.code || "unreachable" };
    }
  }

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

    // 实例自报的 id 与清单不一致，说明这个域名后面是另一个实例（DNS 指错、站点被换过）。
    // 不带这个字段的实例按契约照常判活；带了就必须对得上。
    const reported = typeof body.instance === "string" ? body.instance.trim() : "";
    if (reported && instance?.id && reported !== instance.id) {
      return { status: "down", httpStatus: 200, latencyMs, version: null, error: "instance_mismatch" };
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
// downSince 只在第一次失败时写下；恢复即清空，所以它表示「这一轮连续断了多久」。
export function mergeHealth(previous, result, now = new Date()) {
  const at = now.toISOString();
  const prev = previous || {};
  const healthy = result.status === "up" || result.status === "degraded";
  const countable = result.status !== "unknown";
  const down = result.status === "down";

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
    downSince: healthy ? null : down ? prev.downSince ?? at : prev.downSince ?? null,
    notified: healthy ? {} : prev.notified && typeof prev.notified === "object" ? { ...prev.notified } : {},
    hiddenAt: healthy ? null : prev.hiddenAt ?? null,
    hiddenReason: healthy ? null : prev.hiddenReason ?? null,
  };
}

/**
 * 按连续时长决定提醒、隐藏与恢复。纯函数，不写文件、不发信。
 *
 * 返回的 notices 是本次新发生的事件，调用方据此发信；同一个事件只会出现一次，
 * 记在 state.notified 里。隐藏只影响门户渲染，`instances.json` 不动。
 *
 * @returns {{ state: object, notices: Array<{kind: string, at: string}> }}
 */
export function applyPolicy(instance, state, now = new Date()) {
  const at = now.toISOString();
  const next = { ...state, notified: { ...(state?.notified || {}) } };
  const notices = [];

  // 暂停或退役的条目不参与，也不悄悄改它的历史状态。
  if (instance?.status && instance.status !== "active") {
    next.hiddenAt = null;
    next.hiddenReason = null;
    return { state: next, notices };
  }

  if (next.status === "up" || next.status === "degraded") {
    next.downSince = null;
    next.notified = {};
    next.hiddenAt = null;
    next.hiddenReason = null;
    return { state: next, notices };
  }

  if (next.status === "down") {
    const downSince = next.downSince || at;
    next.downSince = downSince;
    const age = Date.parse(at) - Date.parse(downSince);

    if (age >= DOWN_HIDE_MS) {
      if (!next.hiddenAt) {
        next.hiddenAt = at;
        next.hiddenReason = "down_7d";
        next.notified.down_7d = at;
        notices.push({ kind: "down_7d", at });
      }
      return { state: next, notices };
    }

    if (age >= DOWN_REMIND_MS && !next.notified.down_24h) {
      next.notified.down_24h = at;
      notices.push({ kind: "down_24h", at });
    }
    return { state: next, notices };
  }

  // 从未接通：healthUrl 为空或一直探测不到。以清单的 since 起算。
  // 只有「没有健康检查地址」才走这条，避免把刚签发、正在交接的条目误判成断连。
  if (!instance?.healthUrl) {
    const since = Date.parse(`${instance?.since || ""}T00:00:00Z`);
    if (Number.isFinite(since)) {
      const age = Date.parse(at) - since;
      if (age >= NEVER_HIDE_MS) {
        if (!next.hiddenAt) {
          next.hiddenAt = at;
          next.hiddenReason = "never_30d";
          next.notified.never_30d = at;
          notices.push({ kind: "never_30d", at });
        }
      } else if (age >= NEVER_REMIND_MS && !next.notified.never_14d) {
        next.notified.never_14d = at;
        notices.push({ kind: "never_14d", at });
      }
    }
  }

  return { state: next, notices };
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
    write = true,
    now = () => new Date(),
    resolve = resolveHosts,
    log = () => {},
  } = options;

  const manifest = await readJson(instancesPath, null);
  if (!manifest || !Array.isArray(manifest.instances)) {
    throw new Error(`cannot read instances: ${instancesPath}`);
  }

  const previous = await readJson(outPath, { instances: {} });
  const at = now();

  // 逐个实例并发探测，同时最多跑 concurrency 个，结果按清单顺序返回。
  const notices = [];
  const entries = await mapWithConcurrency(manifest.instances, concurrency, async (instance) => {
    const previousState = previous?.instances?.[instance?.id] || null;
    // 同一个子域被下架后又重新签发时，since 会变；旧条目的 hiddenAt / downSince
    // 不能跟过来，否则新实例一上线就被当成断连七天。跨代的状态一律丢弃。
    const reissued =
      previousState?.manifestSince && instance?.since && previousState.manifestSince !== instance.since;
    const before = reissued ? null : previousState;
    // 暂停或已退役的条目不探，保留上一次的结果。
    if (instance?.status && instance.status !== "active") {
      return [instance.id, before ?? unknownState(before)];
    }
    const result = await probe(instance, { fetchImpl, timeoutMs, degradedMs, resolve });
    const merged = mergeHealth(before, result, at);
    const policy = applyPolicy(instance, merged, at);
    for (const notice of policy.notices) notices.push({ id: instance.id, ...notice });
    return [instance.id, { ...policy.state, manifestSince: instance?.since ?? null }];
  });

  for (const [id, state] of entries) {
    log(`${id}: ${state.status}${state.error ? ` (${state.error})` : ""}${state.hiddenAt ? " [hidden]" : ""}`);
  }

  // 文件里只存状态；本次新发生的事件随返回值交给调用方，不落盘，
  // 否则下一次运行会把旧事件再读出来、重复发信。
  const output = { checkedAt: at.toISOString(), instances: Object.fromEntries(entries) };
  if (write) {
    await mkdir(path.dirname(outPath), { recursive: true });
    const tmp = `${outPath}.${process.pid}.tmp`;
    await writeFile(tmp, `${JSON.stringify(output, null, 2)}\n`);
    await rename(tmp, outPath);
  }
  return { ...output, notices };
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
