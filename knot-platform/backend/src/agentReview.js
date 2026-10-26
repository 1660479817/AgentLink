// 审核工作量快照：只读、只查库、永不抛。
//
// 这条旁路的失败方式不是报错，而是「什么都没发生」：终审不落地，作者收到一条警告，
// 然后没有人知道已经卡了多久。所以这里量的是「多久没成功」「积压多深」「重试到顶多少」
// 「最近失败成什么样」，全部从 intel 与 admin_actions 已有的列里算，不新增表、不新增列，
// 也不在 Agent 的请求路径上写任何东西。
//
// 每个查询都按 created_at 收 30 天窗口：intel 上 verdict 没有索引，但
// intel_feed_time_idx 能按时间范围扫，代价因此不随表长增长。窗口天数一并放进返回值，
// 免得「最后一次成功是 null」被读成「从来没成功过」。

const WINDOW_DAYS = 30;
const MAX_ATTEMPTS = 10;
const CACHE_MS = 30_000;

// 一条查询取完审核的六个数。FILTER 让空表也返回一行 null，形状因此稳定。
const REVIEW_SQL = `
  SELECT
    max(i.updated_at) FILTER (WHERE i.verdict IN ('passed','rejected')) AS last_success_at,
    count(*) FILTER (WHERE i.verdict = 'pending')::int                   AS pending_count,
    min(i.created_at) FILTER (WHERE i.verdict = 'pending')               AS pending_oldest,
    count(*) FILTER (
      WHERE i.verdict = 'pending'
        AND CASE WHEN i.detail->>'reviewAttempts' ~ '^[0-9]+$'
                 THEN (i.detail->>'reviewAttempts')::int ELSE 0 END >= $2
    )::int                                                               AS gave_up,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))
      FILTER (WHERE i.verdict IN ('passed','rejected'))                   AS p50,
    percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.updated_at - i.created_at)))
      FILTER (WHERE i.verdict IN ('passed','rejected'))                   AS p95
  FROM intel i
  WHERE i.created_at > now() - make_interval(days => $1)
`;

// 失败码分布：只取最近 24 小时，够看清「现在坏在哪」，不翻历史。
const ERROR_SQL = `
  SELECT i.detail->>'reviewError' AS code, count(*)::int AS n
  FROM intel i
  WHERE i.created_at > now() - interval '24 hours'
    AND i.detail->>'reviewError' IS NOT NULL
  GROUP BY 1
  ORDER BY n DESC
  LIMIT 10
`;

// 巡查事实。admin_actions_patrol_idx 就是 (created_at DESC) WHERE action = 'patrol'
// 上的部分索引，这条只碰巡查行，一天一行。
const PATROL_SQL = `
  SELECT max(a.created_at) AS last_at,
         count(*) FILTER (WHERE a.created_at >= date_trunc('day', now()))::int AS today
  FROM admin_actions a
  WHERE a.action = 'patrol'
`;

// 缓存按 pool 分：同一进程里可能有多个连接池（测试里尤其如此），
// 用模块级单例会把一次测试的结果喂给另一次。
const caches = new WeakMap();

function cacheFor(pool) {
  let entry = caches.get(pool);
  if (!entry) {
    entry = { review: null, patrol: null };
    caches.set(pool, entry);
  }
  return entry;
}

function fresh(entry, key, now) {
  return Boolean(entry && entry.key === key && now - entry.at < CACHE_MS);
}

// 单飞：同一个池上的并发读共用一次查询，管理页刷新不会变成一叠 SQL。
function once(entry, slot, key, now, load) {
  const held = entry[slot];
  if (fresh(held, key, now)) return Promise.resolve(held.value);
  if (held && held.key === key && held.inflight) return held.inflight;
  const inflight = load().then((value) => {
    // 失败不进缓存：一次瞬时故障不该让状态在 30 秒里都显示成坏的。
    // 同时要把 inflight 清掉——留着它等于把这次的失败钉在缓存里。
    entry[slot] = value.ok === false
      ? { key, at: 0, value: null, inflight: null }
      : { key, at: now, value, inflight: null };
    return value;
  });
  entry[slot] = { key, at: 0, value: null, inflight };
  return inflight;
}

const seconds = (value) => (value == null ? null : Math.max(0, Math.round(Number(value) * 10) / 10));

function isoDay(value) {
  if (!value) return null;
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

function minutesSince(value, now) {
  if (!value) return null;
  const at = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((now - at) / 60_000));
}

export function reviewWindow() {
  return { days: WINDOW_DAYS, maxAttempts: MAX_ATTEMPTS };
}

function emptyReview(days, maxAttempts) {
  return {
    ok: false,
    windowDays: days,
    maxAttempts,
    lastSuccessAt: null,
    pending: { count: null, oldestMinutes: null },
    gaveUp: null,
    latencySeconds: { p50: null, p95: null },
    errors24h: [],
  };
}

async function loadReview(pool, days, maxAttempts, now) {
  try {
    const [review, errors] = await Promise.all([
      pool.query(REVIEW_SQL, [days, maxAttempts]),
      pool.query(ERROR_SQL),
    ]);
    const row = review?.rows?.[0] || {};
    return {
      ok: true,
      windowDays: days,
      maxAttempts,
      lastSuccessAt: isoDay(row.last_success_at),
      pending: {
        count: Number(row.pending_count) || 0,
        oldestMinutes: minutesSince(row.pending_oldest, now),
      },
      gaveUp: Number(row.gave_up) || 0,
      latencySeconds: { p50: seconds(row.p50), p95: seconds(row.p95) },
      errors24h: (errors?.rows || []).map((entry) => ({
        code: String(entry.code || ""),
        count: Number(entry.n) || 0,
      })),
    };
  } catch {
    // 查不了就是查不了：全 null，让页面说「未知」，而不是把 0 当成事实说出去。
    return emptyReview(days, maxAttempts);
  }
}

export async function agentReviewSnapshot(pool, options = {}) {
  const days = Number(options.windowDays) || WINDOW_DAYS;
  const maxAttempts = Number(options.maxAttempts) || MAX_ATTEMPTS;
  const now = Number(options.now) || Date.now();
  const entry = cacheFor(pool);
  return once(entry, "review", `${days}:${maxAttempts}`, now, () =>
    loadReview(pool, days, maxAttempts, now)
  );
}

export async function patrolFacts(pool, options = {}) {
  const now = Number(options.now) || Date.now();
  const entry = cacheFor(pool);
  return once(entry, "patrol", "patrol", now, async () => {
    try {
      const { rows } = await pool.query(PATROL_SQL);
      const row = rows?.[0] || {};
      return { ok: true, lastAt: isoDay(row.last_at), today: Number(row.today) || 0 };
    } catch {
      return { ok: false, lastAt: null, today: null };
    }
  });
}

// 测试用：同一个池上的缓存不该跨用例串。
export function resetAgentReviewCache(pool) {
  caches.delete(pool);
}

export const AGENT_REVIEW_SQL = { REVIEW_SQL, ERROR_SQL, PATROL_SQL };
