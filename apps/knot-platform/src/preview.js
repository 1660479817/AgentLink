export async function directMediaReadable(pool, uploadId, userId) {
  const { rows } = await pool.query(
    `SELECT i.user_id, i.kind, i.is_public, i.verdict, parent.user_id AS wish_user_id
     FROM intel_files f
     JOIN intel i ON i.id = f.intel_id
     LEFT JOIN intel parent ON parent.id = i.responds_to AND parent.kind = 'wish'
     WHERE f.upload_id = $1`,
    [uploadId]
  );
  for (const row of rows) {
    if (userId && row.user_id === userId) return true;
    if (row.verdict !== "pending" && row.verdict !== "passed") continue;
    if ((row.kind === "post" || row.kind === "fastpost") && row.is_public) return true;
    if (row.kind === "wish") return true;
    if (row.kind === "wishRespond" && userId && row.wish_user_id === userId) return true;
  }
  return false;
}
