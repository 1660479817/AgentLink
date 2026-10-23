// 注意力打点：只记不扣费。读痕迹和检索事件是「筛选与压缩」的计费候选点，
// 先量化为数据给精算师看，等数据够了再决定是否计价、怎么计价。

import { searchConfig } from "./searchConfig.js";

export function recordIntelRead(pool, userId, intelId) {
  if (!userId || !intelId) return Promise.resolve();
  return pool.query(
    `INSERT INTO intel_reads (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, intelId]
  );
}

export function recordSearchEvent(pool, userId, query) {
  const text = String(query || "").trim();
  if (!userId || !text) return Promise.resolve();
  return pool.query(
    `INSERT INTO search_events (account_id, query) VALUES ($1, $2)`,
    [userId, text]
  );
}

// 注意力快照：给精算师读的两个数——累计读痕迹和累计检索次数。
export async function attentionSnapshot(pool) {
  const [reads, searches] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM intel_reads`),
    pool.query(`SELECT count(*)::int AS n FROM search_events`),
  ]);
  return {
    reads: Number(reads.rows[0]?.n) || 0,
    searches: Number(searches.rows[0]?.n) || 0,
  };
}

// 检索事件只追加、不参与业务，留久了只会让 count(*) 越来越慢。
// 按天清理一次，保留天数由 KNOT_SEARCH_EVENT_RETENTION_DAYS 决定，0 表示永久保留。
export async function pruneSearchEvents(pool, days) {
  const keep = Number(days) || 0;
  if (keep <= 0) return 0;
  const { rowCount } = await pool.query(
    `DELETE FROM search_events WHERE created_at < now() - make_interval(days => $1)`,
    [keep]
  );
  return rowCount || 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startSearchEventRetention(pool) {
  const days = searchConfig().searchEventRetentionDays;
  if (days <= 0) return null;
  const run = () => pruneSearchEvents(pool, days).catch((error) => console.error(error));
  // 启动后先等一分钟再清，避开启动时的迁移与回填；之后每天一次。
  const first = setTimeout(run, 60_000);
  first.unref();
  const timer = setInterval(run, DAY_MS);
  timer.unref();
  return timer;
}
