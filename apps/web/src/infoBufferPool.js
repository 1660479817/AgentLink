import { fetchWebSnapshot } from "./api.js";

/** @typedef {'idle'|'loading'|'ready'|'error'} PoolStatus */

const DEFAULT_REFRESH_MS = 60_000;
const JITTER_RATIO = 0.08;

/** @type {import('./api.js').WebSnapshotResponse | null} */
let merged = null;

/** @type {PoolStatus} */
let status = "idle";
/** @type {string | null} */
let lastError = null;
/** @type {Promise<void> | null} */
let inflight = null;
/** @type {string | null} */
let inflightKey = null;

/** @type {Set<() => void>} */
const listeners = new Set();
/** @type {ReturnType<typeof setTimeout> | null} */
let refreshTimer = null;

const EMPTY_SURFACES = Object.freeze({});
const EMPTY_ERRORS = Object.freeze({});

/** @type {ReturnType<typeof buildPublicState> | null} */
let cachedPublicState = null;

function buildPublicState() {
  return {
    snapshot: merged,
    status,
    lastError,
    refreshAfterMs: merged?.refreshAfterMs ?? DEFAULT_REFRESH_MS,
    generatedAt: merged?.generatedAt ?? null,
    viewer: merged?.viewer ?? null,
    surfaces: merged?.surfaces ?? EMPTY_SURFACES,
    errors: merged?.errors ?? EMPTY_ERRORS,
  };
}

function refreshPublicStateCache() {
  cachedPublicState = buildPublicState();
}

/** @type {() => import('./api.js').PullRequest} */
let desiredPull = () => ({ surfaces: ["home", "plaza"] });

/** @type {{ q: string; cursor: string | null; limit: number }} */
let lastPlazaQuery = { q: "", cursor: null, limit: 20 };

export function getLastPlazaQuery() {
  return { ...lastPlazaQuery };
}

export function setLastPlazaQuery(partial) {
  lastPlazaQuery = { ...lastPlazaQuery, ...partial };
}

function notify() {
  refreshPublicStateCache();
  for (const fn of listeners) {
    fn();
  }
}

function requestKey(req) {
  const surfaces = [...req.surfaces].sort().join(",");
  const pq = req.plaza ?? {};
  return `${surfaces}|q=${pq.q ?? ""}|cursor=${pq.cursor ?? ""}|limit=${pq.limit ?? ""}`;
}

function mergeSnapshot(prev, next) {
  if (!prev) return next;
  return {
    ...next,
    surfaces: {
      ...(prev.surfaces || {}),
      ...(next.surfaces || {}),
    },
    errors: {
      ...(prev.errors || {}),
      ...(next.errors || {}),
    },
  };
}

function scheduleNextRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  const ms = merged?.refreshAfterMs ?? DEFAULT_REFRESH_MS;
  const jitter = ms * JITTER_RATIO * (Math.random() * 2 - 1);
  const delay = Math.max(1000, Math.floor(ms + jitter));
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    pullSnapshot(desiredPull(), { reason: "scheduled" }).catch(() => {});
  }, delay);
}

/**
 * @param {import('./api.js').PullRequest} req
 * @param {{ force?: boolean; reason?: string }} [opts]
 */
export async function pullSnapshot(req, opts = {}) {
  const key = requestKey(req);
  if (!opts.force && inflight && inflightKey === key) {
    return inflight;
  }
  status = "loading";
  lastError = null;
  notify();

  if (req.surfaces.includes("plaza")) {
    const pq = req.plaza ?? {};
    setLastPlazaQuery({
      q: pq.q ?? lastPlazaQuery.q,
      cursor: pq.cursor ?? null,
      limit: pq.limit ?? lastPlazaQuery.limit,
    });
  }

  inflightKey = key;
  inflight = (async () => {
    try {
      const next = await fetchWebSnapshot(req);
      merged = mergeSnapshot(merged, next);
      status = "ready";
      scheduleNextRefresh();
    } catch (e) {
      status = merged ? "ready" : "error";
      lastError = e.code || e.message || "fetch_failed";
      if (!merged) throw e;
    } finally {
      inflight = null;
      notify();
    }
  })();

  return inflight;
}

/** 写操作后强制与平台对齐 */
export function invalidateSnapshot() {
  return pullSnapshot(desiredPull(), { force: true, reason: "invalidate" });
}

export function setDesiredPull(fn) {
  desiredPull = fn;
}

export function startBufferScheduler() {
  scheduleNextRefresh();
}

export function stopBufferScheduler() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

export function subscribeInfoBuffer(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInfoBufferState() {
  if (!cachedPublicState) refreshPublicStateCache();
  return cachedPublicState;
}
