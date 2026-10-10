import { todayBoundsUtc } from "../web-display-config.js";

/** @typedef {import('pg').Pool} Pool */

/**
 * 从库中读取首页展示所需的原始事实（不做 JSON 契约、不做美化）。
 * @param {Pool} pool
 * @param {import('../web-display-config.js').WebDisplayConfig} webCfg
 */
export async function readHomeFacts(pool, webCfg) {
  const day = todayBoundsUtc(webCfg.statsTimezone);
  const totalSql =
    webCfg.cardsTotalMode === "all_cards"
      ? "SELECT COUNT(*)::int AS c FROM information_cards"
      : "SELECT COUNT(*)::int AS c FROM information_cards WHERE visibility = 'public'";

  const [totalRes, newTodayRes, ingestDoneTotalRes, ingestDoneTodayRes, previewRes] =
    await Promise.all([
      pool.query(totalSql),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM information_cards
         WHERE created_at >= $1 AND created_at < $2`,
        [day.start, day.end]
      ),
      pool.query(`SELECT COUNT(*)::int AS c FROM ingest_jobs WHERE status = 'done'`),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM ingest_jobs
         WHERE status = 'done' AND updated_at >= $1 AND updated_at < $2`,
        [day.start, day.end]
      ),
      pool.query(
        `SELECT id, title, summary, thumb_url, visibility, created_at
         FROM information_cards
         WHERE visibility = 'public'
         ORDER BY created_at DESC
         LIMIT $1`,
        [webCfg.homePreviewSize]
      ),
    ]);

  return {
    statsTimezone: webCfg.statsTimezone,
    statsRaw: {
      cardsTotal: totalRes.rows[0]?.c ?? 0,
      cardsNewToday: newTodayRes.rows[0]?.c ?? 0,
      exchangesToday: 0,
      ingestSessionsDoneTotal: ingestDoneTotalRes.rows[0]?.c ?? 0,
      ingestSessionsDoneToday: ingestDoneTodayRes.rows[0]?.c ?? 0,
    },
    previewCardRows: previewRes.rows,
  };
}

/**
 * @param {Pool} pool
 * @param {{ userId?: string } | null} viewer
 * @param {{ q: string, limit: number, cursor: { createdAt: Date, id: string } | null }} opts
 */
export async function readPlazaPage(pool, viewer, { q, limit, cursor }) {
  const hasUser = Boolean(viewer);
  const params = [];
  let sql = `SELECT id, title, summary, thumb_url, visibility, created_at
             FROM information_cards WHERE 1=1`;
  if (!hasUser) {
    sql += ` AND visibility = 'public'`;
  } else {
    sql += ` AND visibility IN ('public', 'registered', 'verified')`;
  }
  if (q) {
    params.push(`%${q}%`);
    sql += ` AND (title ILIKE $${params.length} OR summary ILIKE $${params.length})`;
  }
  if (cursor?.createdAt && cursor?.id) {
    params.push(cursor.createdAt, cursor.id);
    sql += ` AND (created_at, id) < ($${params.length - 1}, $${params.length})`;
  }
  params.push(limit + 1);
  sql += ` ORDER BY created_at DESC, id DESC LIMIT $${params.length}`;

  const { rows } = await pool.query(sql, params);
  return { cardRows: rows, limit, q: q || null };
}

/**
 * @param {Pool} pool
 * @param {string} userId
 */
export async function readMineFacts(pool, userId) {
  const [tokenRes, procRes, jobsRes, cardsRes] = await Promise.all([
    pool.query(
      `SELECT 1 FROM agent_tokens WHERE user_id = $1 AND status = 'active' LIMIT 1`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS c FROM ingest_jobs
       WHERE user_id = $1 AND status IN ('pending', 'processing')`,
      [userId]
    ),
    pool.query(
      `SELECT j.id, j.status, j.error, j.created_at, j.updated_at, u.mime
       FROM ingest_jobs j
       JOIN uploads u ON u.id = j.upload_id
       WHERE j.user_id = $1
       ORDER BY j.created_at DESC
       LIMIT 10`,
      [userId]
    ),
    pool.query(
      `SELECT id, title, summary, thumb_url, visibility, created_at
       FROM information_cards
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [userId]
    ),
  ]);

  return {
    agentTokenActive: tokenRes.rows.length > 0,
    ingestProcessingCount: procRes.rows[0]?.c ?? 0,
    ingestJobRows: jobsRes.rows,
    myCardRows: cardsRes.rows,
  };
}
