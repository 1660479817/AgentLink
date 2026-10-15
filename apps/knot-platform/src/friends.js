import { recordNotification } from "./notifications.js";
import { publicUploadUrl } from "./uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENTION_KINDS = new Set(["post", "fastpost", "wish"]);
const MENTION_BODY = 2000;

export const MAX_MENTIONS = 8;

export const FRIEND_COLUMNS = `
    (
      $1::uuid IS NOT NULL
      AND i.user_id <> $1
      AND NOT EXISTS (
        SELECT 1 FROM friend_dismissals fd
        WHERE fd.user_id = $1 AND fd.friend_id = i.user_id
      )
      AND (
        u.side = 'internal'
        OR EXISTS (
          SELECT 1 FROM friendships fs
          WHERE fs.user_id = $1 AND fs.friend_id = i.user_id
        )
      )
    ) AS friend,
    ($1::uuid IS NOT NULL AND i.user_id <> $1) AS can_friend`;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function presentFriend(row) {
  return {
    id: row.id,
    displayName: row.display_name || "",
    avatarUrl: row.avatar_upload_id ? publicUploadUrl(row.avatar_upload_id) : null,
  };
}

export function mentionList(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw fail("bad_mention");
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = String(item ?? "").trim();
    if (!UUID.test(id)) throw fail("bad_mention");
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (ids.length > MAX_MENTIONS) throw fail("bad_mention");
  return ids;
}

export async function listFriends(pool, userId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name, u.avatar_upload_id
     FROM users u
     WHERE u.id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM friend_dismissals d
         WHERE d.user_id = $1 AND d.friend_id = u.id
       )
       AND (
         u.side = 'internal'
         OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.user_id = $1 AND f.friend_id = u.id
         )
       )
     ORDER BY u.display_name ASC, u.created_at ASC`,
    [userId]
  );
  return rows.map(presentFriend);
}

export async function assertFriends(pool, userId, mentions) {
  if (!mentions.length) return;
  const { rows } = await pool.query(
    `SELECT u.id
     FROM users u
     WHERE u.id = ANY($2::uuid[])
       AND u.id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM friend_dismissals d
         WHERE d.user_id = $1 AND d.friend_id = u.id
       )
       AND (
         u.side = 'internal'
         OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.user_id = $1 AND f.friend_id = u.id
         )
       )`,
    [userId, mentions]
  );
  if (rows.length !== mentions.length) throw fail("bad_mention");
}

async function friendUser(pool, friendId) {
  const { rows } = await pool.query(`SELECT id, side FROM users WHERE id = $1`, [friendId]);
  if (!rows[0]) throw fail("not_found");
  return rows[0];
}

export async function addFriend(pool, userId, friendId) {
  const friend = await friendUser(pool, friendId);
  if (friend.id === userId) throw fail("bad_state");
  await pool.query(`DELETE FROM friend_dismissals WHERE user_id = $1 AND friend_id = $2`, [userId, friendId]);
  await pool.query(
    `INSERT INTO friendships (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, friendId]
  );
  return { friend: true };
}

export async function removeFriend(pool, userId, friendId) {
  const friend = await friendUser(pool, friendId);
  if (friend.id === userId) throw fail("bad_state");
  await pool.query(`DELETE FROM friendships WHERE user_id = $1 AND friend_id = $2`, [userId, friendId]);
  if (friend.side === "internal") {
    await pool.query(
      `INSERT INTO friend_dismissals (user_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, friendId]
    );
  }
  return { friend: false };
}

export async function setCardFriend(pool, userId, intelId, friend) {
  const { rows } = await pool.query(
    `SELECT user_id FROM intel
     WHERE id = $1 AND verdict = 'passed' AND is_public AND kind IN ('post', 'fastpost')`,
    [intelId]
  );
  if (!rows[0]) throw fail("not_found");
  if (friend) return addFriend(pool, userId, rows[0].user_id);
  return removeFriend(pool, userId, rows[0].user_id);
}

export async function directMentions(pool, { authorId, intelId, kind, body, mentions }) {
  if (!mentions?.length) return;
  if (!MENTION_KINDS.has(kind)) throw fail("bad_mention");
  await assertFriends(pool, authorId, mentions);
  const text = String(body || "").trim().slice(0, MENTION_BODY) || "一条信息";
  const href = kind === "wish" ? "/wish" : "/discover";
  for (const friendId of mentions) {
    const inserted = await pool.query(
      `INSERT INTO intel_mentions (intel_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING user_id`,
      [intelId, friendId]
    );
    if (!inserted.rows.length) continue;
    await recordNotification(pool, {
      userId: friendId,
      kind: "mention",
      title: "有人@了你",
      body: text,
      href,
      intelId,
    });
  }
}
