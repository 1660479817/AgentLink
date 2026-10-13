import { cardPreviewUrl } from "./information.js";
import { publicUploadUrl } from "./uploads.js";

function videosOf(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? { url: item } : { url: item?.url || "", poster: item?.poster || "" }))
    .filter((item) => item.url);
}

export async function listRequests(pool, viewerId = null) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.videos, i.user_id, i.created_at,
            (SELECT count(*)::int FROM intel r
             WHERE r.responds_to = i.id AND r.kind = 'response' AND r.verdict = 'passed') AS response_count,
            EXISTS (
              SELECT 1 FROM request_unlocks u
              WHERE u.intel_id = i.id AND u.user_id = $1
            ) AS unlocked
     FROM intel i
     WHERE i.kind = 'request' AND i.verdict = 'passed'
     ORDER BY i.created_at DESC`,
    [viewerId]
  );
  const ids = rows.map((row) => row.id);
  const names = new Map();
  if (ids.length) {
    const found = await pool.query(
      `SELECT f.intel_id, u.original_name, u.mime
       FROM intel_files f
       JOIN uploads u ON u.id = f.upload_id
       WHERE f.intel_id = ANY($1::uuid[])
       ORDER BY f.sort_order, f.upload_id`,
      [ids]
    );
    for (const file of found.rows) {
      const list = names.get(file.intel_id) || [];
      list.push({ name: file.original_name || "", mime: file.mime || "" });
      names.set(file.intel_id, list);
    }
  }
  return rows.map((row) => {
    const mine = Boolean(viewerId && row.user_id === viewerId);
    return {
      id: row.id,
      body: row.body || "",
      videos: videosOf(row.videos),
      fileNames: names.get(row.id) || [],
      previewUrl: cardPreviewUrl(row.id, names.get(row.id) || []),
      mine,
      unlocked: mine || Boolean(row.unlocked),
      responseCount: mine ? Number(row.response_count) || 0 : 0,
      createdAt: row.created_at,
    };
  });
}

async function fileNamesByIntel(pool, ids) {
  const names = new Map();
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return names;
  const found = await pool.query(
    `SELECT f.intel_id, u.original_name, u.mime
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = ANY($1::uuid[])
     ORDER BY f.sort_order, f.upload_id`,
    [unique]
  );
  for (const file of found.rows) {
    const list = names.get(file.intel_id) || [];
    list.push({ name: file.original_name || "", mime: file.mime || "" });
    names.set(file.intel_id, list);
  }
  return names;
}

export async function listMyResponses(pool, userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.body, r.videos, r.verdict, r.reject_reason, r.price, r.created_at, r.responds_to,
            q.body AS wish_body, q.videos AS wish_videos
     FROM intel r
     LEFT JOIN intel q ON q.id = r.responds_to AND q.kind = 'request'
     WHERE r.user_id = $1 AND r.kind = 'response'
     ORDER BY r.created_at DESC`,
    [userId]
  );
  const ids = rows.flatMap((row) => [row.id, row.responds_to]);
  const names = await fileNamesByIntel(pool, ids);
  return rows.map((row) => ({
    id: row.id,
    body: row.body || "",
    videos: videosOf(row.videos),
    fileNames: names.get(row.id) || [],
    previewUrl: cardPreviewUrl(row.id, names.get(row.id) || []),
    verdict: row.verdict || "pending",
    rejectReason: row.reject_reason || "",
    price: Number(row.price) || 0,
    createdAt: row.created_at,
    wish: row.responds_to
      ? {
          id: row.responds_to,
          body: row.wish_body || "",
          videos: videosOf(row.wish_videos),
          fileNames: names.get(row.responds_to) || [],
          previewUrl: cardPreviewUrl(row.responds_to, names.get(row.responds_to) || []),
        }
      : null,
  }));
}

export async function listRequestResponses(pool, userId, requestId) {
  const owned = await pool.query(
    `SELECT id FROM intel WHERE id = $1 AND user_id = $2 AND kind = 'request'`,
    [requestId, userId]
  );
  if (!owned.rows.length) return { error: "not_found", status: 404 };
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.videos, i.category, i.price, i.created_at,
            u.display_name, u.avatar_upload_id,
            EXISTS (
              SELECT 1 FROM packet_downloads pd
              WHERE pd.intel_id = i.id AND pd.user_id = $2
            ) AS granted
     FROM intel i
     JOIN users u ON u.id = i.user_id
     WHERE i.responds_to = $1 AND i.kind = 'response' AND i.verdict = 'passed'
     ORDER BY i.created_at ASC`,
    [requestId, userId]
  );
  const ids = rows.map((row) => row.id);
  const names = new Map();
  if (ids.length) {
    const found = await pool.query(
      `SELECT f.intel_id, u.original_name, u.mime
       FROM intel_files f
       JOIN uploads u ON u.id = f.upload_id
       WHERE f.intel_id = ANY($1::uuid[])
       ORDER BY f.sort_order, f.upload_id`,
      [ids]
    );
    for (const file of found.rows) {
      const list = names.get(file.intel_id) || [];
      list.push({ name: file.original_name || "", mime: file.mime || "" });
      names.set(file.intel_id, list);
    }
  }
  return {
    responses: rows.map((row) => ({
      id: row.id,
      body: row.body || "",
      videos: videosOf(row.videos),
      category: row.category || "",
      price: Number(row.price) || 0,
      createdAt: row.created_at,
      granted: Boolean(row.granted),
      author: {
        name: row.display_name || "",
        avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
      },
      fileNames: (names.get(row.id) || []).map((file) => file.name).filter(Boolean),
      previewUrl: cardPreviewUrl(row.id, names.get(row.id) || []),
    })),
  };
}
