const CONNECT_COST = 1;

export { CONNECT_COST };

export async function getBalance(pool, personId) {
  const { rows } = await pool.query(`SELECT points_balance FROM persons WHERE id = $1`, [personId]);
  return rows[0]?.points_balance ?? 0;
}

export async function adjustPoints(pool, { personId, delta, reason, refId = null }) {
  const { rows } = await pool.query(
    `UPDATE persons SET points_balance = points_balance + $2 WHERE id = $1 RETURNING points_balance`,
    [personId, delta]
  );
  if (!rows.length) throw new Error("person_not_found");
  await pool.query(
    `INSERT INTO point_ledger (person_id, delta, reason, ref_id) VALUES ($1, $2, $3, $4)`,
    [personId, delta, reason, refId]
  );
  return rows[0].points_balance;
}
