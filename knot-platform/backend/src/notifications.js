export async function recordNotification(pool, { userId, kind, title, body = "", href = null, intelId = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, kind, title, body, href, intel_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [userId, kind, title, body, href, intelId]
  );
  return rows[0].id;
}

export function presentNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    intelId: row.intel_id || null,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
  };
}

export async function listNotifications(pool, userId) {
  const { rows } = await pool.query(
    `SELECT id, kind, title, body, href, intel_id, read_at, created_at
     FROM notifications
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId]
  );
  return {
    unread: rows.filter((row) => !row.read_at).length,
    notifications: rows.map(presentNotification),
  };
}

export async function markNotificationsRead(pool, userId) {
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return { ok: true };
}

// system 是平台对账户和内容的动作，social 是有人跟你互动。分组由 kind 推出，不另存一列。
const NOTICE_GROUPS = {
  intel_rejected: "system",
  intel_review_error: "system",
  intel_removed: "system",
  retrieval_failed: "system",
  warning: "system",
  points_granted: "system",
  muted: "system",
  unmuted: "system",
  entitled: "system",
  level_changed: "system",
  mention: "social",
  request_response: "social",
  tip: "social",
};

const SYSTEM_KINDS = Object.keys(NOTICE_GROUPS).filter((kind) => NOTICE_GROUPS[kind] === "system");

export const NOTICE_SUMMARY_LIMIT = 5;

export function noticeGroup(kind) {
  return NOTICE_GROUPS[kind] === "social" ? "social" : "system";
}

// 捎在每次 Agent 请求上的未读摘要：计数恒定在，条目只带最近几条。
export async function noticeSummary(pool, userId, limit = NOTICE_SUMMARY_LIMIT) {
  const [counted, listed] = await Promise.all([
    pool.query(
      `SELECT kind, count(*)::int AS n
       FROM notifications
       WHERE user_id = $1 AND read_at IS NULL
       GROUP BY kind`,
      [userId]
    ),
    pool.query(
      `SELECT id, kind, title, body, href, intel_id, read_at, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY (read_at IS NULL) DESC, (kind = ANY($2::text[])) DESC, created_at DESC
       LIMIT $3`,
      [userId, SYSTEM_KINDS, limit]
    ),
  ]);
  const groups = { system: 0, social: 0 };
  let unread = 0;
  for (const row of counted.rows) {
    const count = Number(row.n) || 0;
    unread += count;
    groups[noticeGroup(row.kind)] += count;
  }
  return {
    unread,
    groups,
    latest: listed.rows.map(presentNotification),
  };
}
