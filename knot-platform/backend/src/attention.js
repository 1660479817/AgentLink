// 注意力打点：只记不扣费。读痕迹和检索事件是「筛选与压缩」的计费候选点，
// 先量化为数据给精算师看，等数据够了再决定是否计价、怎么计价。

export function recordIntelRead(pool, userId, intelId) {
  if (!userId || !intelId) return Promise.resolve();
  return pool.query(
    `INSERT INTO intel_reads (user_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, intelId]
  );
}

export function recordSearchEvent(pool, userId, query) {
  const text = String(query || "").trim();
  if (!userId || !text) return Promise.resolve();
  return pool.query(
    `INSERT INTO search_events (user_id, query) VALUES ($1, $2)`,
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
