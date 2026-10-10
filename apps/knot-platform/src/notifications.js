export async function recordNotification(pool, { userId, kind, title, body = "", href = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, kind, title, body, href)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, kind, title, body, href]
  );
  return rows[0].id;
}
