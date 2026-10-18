import { cardImageUrl } from "./uploads.js";

// 封面图存在 intel.videos 的 poster 字段里，不进 intel_files（否则会被当成正文图片）。
// 所以直链可读性除了看 intel_files，还要看有没有已公开的帖子拿它当视频封面。
export async function directMediaReadable(pool, uploadId, userId) {
  const { rows } = await pool.query(
    `SELECT i.user_id, i.kind, i.is_public, i.verdict, parent.user_id AS wish_user_id
     FROM intel_files f
     JOIN intel i ON i.id = f.intel_id
     LEFT JOIN intel parent ON parent.id = i.responds_to AND parent.kind = 'wish'
     WHERE f.upload_id = $1
     UNION
     SELECT i.user_id, i.kind, i.is_public, i.verdict, NULL::uuid AS wish_user_id
     FROM intel i
     WHERE i.videos @> jsonb_build_array(jsonb_build_object('poster', $2::text))`,
    [uploadId, cardImageUrl(String(uploadId || "").toLowerCase())]
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
