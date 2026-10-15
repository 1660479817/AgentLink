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
