// 检索链路的可调参数。默认值与 packages/knot-config/src/schema.mjs 里登记的默认值一致，
// packages/knot-config/src/schema.test.js 会逐个核对；改一处就要同时改两处。
//
// 每次调用都重新读环境变量：这些值只在请求进来时用一次，没有热路径开销，
// 测试也可以直接改 process.env 而不必重启模块。

function nonNegativeInt(raw, fallback) {
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function positiveInt(raw, fallback) {
  return Math.max(1, nonNegativeInt(raw, fallback));
}

// 与 schema 里的 max 对齐。schema 只校验写在 platform.env 里的值；进程环境可能来自别处，
// 这里再夹一次，避免一个手滑的 10^9 把候选行全收进内存。
function capped(value, max) {
  return Math.min(max, value);
}

export function searchConfig() {
  return {
    // 一次检索最多收进内存打分的候选行数。索引先把不可能命中的行挡掉，这里是内存墙。
    candidates: capped(positiveInt(process.env.KNOT_SEARCH_CANDIDATES, 2000), 50000),
    // 返回条数。信息流与搜索共用 30 的观感，改这里只影响搜索。
    results: capped(positiveInt(process.env.KNOT_SEARCH_RESULTS, 30), 200),
    // 查询串长度上限，超出的部分截断（不报错，避免代理因为长句直接失败）。
    queryMax: capped(positiveInt(process.env.KNOT_SEARCH_Q_MAX, 120), 2000),
    // 结果缓存时长（秒）。0 表示不缓存。
    cacheTtlMs: capped(nonNegativeInt(process.env.KNOT_SEARCH_CACHE_TTL, 30), 3600) * 1000,
    // 单个身份每分钟的检索次数。0 表示不限。
    searchRatePerMinute: nonNegativeInt(process.env.KNOT_SEARCH_RATE_PER_MIN, 120),
    // 终审队列同时处理几条。
    reviewConcurrency: capped(positiveInt(process.env.KNOT_REVIEW_CONCURRENCY, 2), 32),
    // 检索打点保留天数。0 表示永久保留。
    searchEventRetentionDays: nonNegativeInt(process.env.KNOT_SEARCH_EVENT_RETENTION_DAYS, 90),
  };
}
