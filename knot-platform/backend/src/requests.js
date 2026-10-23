import { toRecord } from "./card.js";
import { filesByIntel, visibleVerdict } from "./information.js";
import { avatarUrlFor } from "./avatars.js";
import { wishLive } from "./wish.js";

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function listRequests(pool, viewerId = null) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.verdict, i.price, i.category, i.kind, i.is_public, i.account_id, i.actor, i.created_at, i.updated_at, i.expires_at,
            (SELECT count(*)::int FROM intel r
             WHERE r.responds_to = i.id AND r.kind = 'wishRespond' AND ${visibleVerdict("r.verdict")}) AS response_count,
            EXISTS (
              SELECT 1 FROM request_unlocks u
              WHERE u.intel_id = i.id AND u.account_id = $1
            ) AS unlocked
     FROM intel i
     WHERE i.kind = 'wish' AND ${visibleVerdict("i.verdict")} AND ${wishLive("i")}
     ORDER BY i.created_at DESC`,
    [viewerId]
  );
  const files = await filesByIntel(pool, rows.map((row) => row.id));
  return rows.map((row) => {
    const mine = Boolean(viewerId && row.account_id === viewerId);
    const unlocked = mine || Boolean(row.unlocked);
    return {
      ...toRecord(row, { files: files.get(row.id) || [], granted: unlocked }),
      mine,
      unlocked,
      responseCount: mine ? Number(row.response_count) || 0 : 0,
    };
  });
}

export async function listMyResponses(pool, userId) {
  const { rows } = await pool.query(
    `SELECT r.id, r.actor, r.body, r.videos, r.links, r.content_hash, r.detail, r.verdict, r.reject_reason, r.price, r.category, r.kind, r.is_public,
            r.created_at, r.updated_at, r.responds_to,
            q.actor AS wish_actor, q.body AS wish_body, q.videos AS wish_videos, q.links AS wish_links, q.content_hash AS wish_content_hash, q.price AS wish_price,
            q.detail AS wish_detail, q.category AS wish_category, q.verdict AS wish_verdict, q.created_at AS wish_created_at, q.expires_at AS wish_expires_at
     FROM intel r
     LEFT JOIN intel q ON q.id = r.responds_to AND q.kind = 'wish'
     WHERE r.account_id = $1 AND r.kind = 'wishRespond'
     ORDER BY r.created_at DESC`,
    [userId]
  );
  const files = await filesByIntel(pool, rows.flatMap((row) => [row.id, row.responds_to]));
  return rows.map((row) => ({
    ...toRecord(row, { files: files.get(row.id) || [], granted: true }),
    wish: row.responds_to
      ? toRecord(
          {
            id: row.responds_to,
            actor: row.wish_actor,
            body: row.wish_body,
            videos: row.wish_videos,
            links: row.wish_links,
            price: row.wish_price,
            detail: row.wish_detail,
            category: row.wish_category,
            kind: "wish",
            content_hash: row.wish_content_hash,
            is_public: false,
            verdict: row.wish_verdict || "pending",
            created_at: row.wish_created_at,
            expires_at: row.wish_expires_at,
          },
          { files: files.get(row.responds_to) || [], granted: false }
        )
      : null,
  }));
}

export async function listLooks(pool, userId) {
  const { rows } = await pool.query(
    `SELECT i.id, i.actor, i.body, i.videos, i.links, i.content_hash, i.detail, i.verdict, i.price, i.category, i.kind, i.is_public, i.created_at, i.updated_at, i.expires_at,
            l.created_at AS looked_at,
            EXISTS (
              SELECT 1 FROM request_unlocks u
              WHERE u.intel_id = i.id AND u.account_id = $1
            ) AS unlocked
     FROM request_looks l
     JOIN intel i ON i.id = l.intel_id AND i.kind = 'wish' AND ${visibleVerdict("i.verdict")} AND ${wishLive("i")}
     WHERE l.account_id = $1
     ORDER BY l.created_at DESC`,
    [userId]
  );
  const files = await filesByIntel(pool, rows.map((row) => row.id));
  return rows.map((row) => ({
    lookedAt: iso(row.looked_at),
    wish: {
      ...toRecord(row, { files: files.get(row.id) || [], granted: Boolean(row.unlocked) }),
      unlocked: Boolean(row.unlocked),
    },
  }));
}

export async function lookRequest(pool, userId, requestId) {
  const { rows } = await pool.query(
    `SELECT id, account_id FROM intel WHERE id = $1 AND kind = 'wish' AND ${visibleVerdict("verdict")} AND ${wishLive("intel")}`,
    [requestId]
  );
  if (!rows.length) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  if (rows[0].account_id === userId) {
    const error = new Error("bad_state");
    error.code = "bad_state";
    throw error;
  }
  await pool.query(
    `INSERT INTO request_looks (account_id, intel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, requestId]
  );
  const looks = await listLooks(pool, userId);
  return looks.find((item) => item.wish?.id === requestId) || null;
}

export async function listRequestResponses(pool, userId, requestId) {
  const owned = await pool.query(
    `SELECT id FROM intel WHERE id = $1 AND account_id = $2 AND kind = 'wish'`,
    [requestId, userId]
  );
  if (!owned.rows.length) return { error: "not_found", status: 404 };
  const { rows } = await pool.query(
    `SELECT i.id, i.actor, i.body, i.videos, i.links, i.content_hash, i.detail, i.verdict, i.reject_reason, i.category, i.price, i.kind, i.is_public, i.created_at, i.updated_at,
            i.account_id, u.display_name, u.avatar_upload_id, u.role, u.agent_type,
            EXISTS (
              SELECT 1 FROM packet_downloads pd
              WHERE pd.intel_id = i.id AND pd.account_id = $2
            ) AS granted
     FROM intel i
     JOIN accounts u ON u.id = i.account_id
     WHERE i.responds_to = $1 AND i.kind = 'wishRespond' AND ${visibleVerdict("i.verdict")}
     ORDER BY i.created_at ASC`,
    [requestId, userId]
  );
  const files = await filesByIntel(pool, rows.map((row) => row.id));
  return {
    responses: rows.map((row) =>
      toRecord({ ...row, responds_to: requestId }, {
        files: files.get(row.id) || [],
        granted: Boolean(row.granted),
        author: {
          name: row.display_name || "",
          avatarUrl: avatarUrlFor(row),
        },
      })
    ),
  };
}
