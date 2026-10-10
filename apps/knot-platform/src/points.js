export const UNIT_PRICE = 1;

export async function getBalance(pool, userId) {
  const { rows } = await pool.query(`SELECT points_balance FROM users WHERE id = $1`, [userId]);
  return rows[0]?.points_balance ?? 0;
}

export async function applyPoints(client, { userId, delta, reason, refId = null }) {
  const { rows } = await client.query(
    `UPDATE users
     SET points_balance = points_balance + $2
     WHERE id = $1 AND points_balance + $2 >= 0
     RETURNING points_balance`,
    [userId, delta]
  );
  if (!rows.length) throw new Error("insufficient_points");
  await client.query(
    `INSERT INTO point_ledger (user_id, delta, reason, ref_id) VALUES ($1, $2, $3, $4)`,
    [userId, delta, reason, refId]
  );
  return rows[0].points_balance;
}

export async function adjustPoints(pool, entry) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const balance = await applyPoints(client, entry);
    await client.query("COMMIT");
    return balance;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
