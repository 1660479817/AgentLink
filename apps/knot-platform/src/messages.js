export async function recordMessage(pool, { personId, expressionId, door, direction, body, matchId = null }) {
  await pool.query(
    `INSERT INTO messages (person_id, expression_id, door, direction, body, match_id, read_at)
     SELECT $1, $2, $3, $4, $5, $6, NULL
     WHERE NOT EXISTS (
       SELECT 1 FROM messages
       WHERE expression_id = $2 AND direction = $4 AND body = $5 AND match_id IS NOT DISTINCT FROM $6
     )`,
    [personId, expressionId, door, direction, body, matchId]
  );
}
