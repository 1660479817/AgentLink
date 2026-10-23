import { toPlain } from "@knot/markdown";
import { visibleVerdict } from "./information.js";
import { recordNotification } from "./notifications.js";
import { avatarUrlFor } from "./avatars.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENTION_KINDS = new Set(["post", "fastpost", "wish"]);
const MENTION_BODY = 2000;

export const MAX_MENTIONS = 8;

export const FRIEND_COLUMNS = `
    (
      $1::uuid IS NOT NULL
      AND i.account_id <> $1
      AND NOT EXISTS (
        SELECT 1 FROM friend_dismissals fd
        WHERE fd.account_id = $1 AND fd.friend_id = i.account_id
      )
      AND (
        (u.role = 'agent' AND u.side = 'internal')
        OR EXISTS (
          SELECT 1 FROM friendships fs
          WHERE fs.account_id = $1 AND fs.friend_id = i.account_id
        )
      )
    ) AS friend,
    ($1::uuid IS NOT NULL AND i.account_id <> $1 AND u.role <> 'platform') AS can_friend`;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function presentFriend(row) {
  return {
    id: row.id,
    displayName: row.display_name || "",
    avatarUrl: avatarUrlFor(row),
    level: row.level ?? 1,
    pointsBalance: row.points_balance ?? 0,
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
  // Agent 没有自己的钱包：等级与积分按它的主人显示，别让朋友列表里出现 1 级、0 分。
  const { rows } = await pool.query(
    `SELECT u.id, u.display_name, u.avatar_upload_id, u.role, u.agent_type,
            CASE WHEN u.role = 'agent' THEN COALESCE(o.level, 1) ELSE u.level END AS level,
            CASE WHEN u.role = 'agent' THEN COALESCE(o.points_balance, 0) ELSE u.points_balance END AS points_balance
     FROM accounts u
     LEFT JOIN accounts o ON o.id = u.owner_id
     WHERE u.id <> $1
       AND u.role <> 'platform'
       AND NOT EXISTS (
         SELECT 1 FROM friend_dismissals d
         WHERE d.account_id = $1 AND d.friend_id = u.id
       )
       AND (
         (u.role = 'agent' AND u.side = 'internal')
         OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.account_id = $1 AND f.friend_id = u.id
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
     FROM accounts u
     WHERE u.id = ANY($2::uuid[])
       AND u.id <> $1
       AND u.role <> 'platform'
       AND NOT EXISTS (
         SELECT 1 FROM friend_dismissals d
         WHERE d.account_id = $1 AND d.friend_id = u.id
       )
       AND (
         (u.role = 'agent' AND u.side = 'internal')
         OR EXISTS (
           SELECT 1 FROM friendships f
           WHERE f.account_id = $1 AND f.friend_id = u.id
         )
       )`,
    [userId, mentions]
  );
  if (rows.length !== mentions.length) throw fail("bad_mention");
}

async function friendUser(pool, friendId) {
  const { rows } = await pool.query(`SELECT id, role, side FROM accounts WHERE id = $1`, [friendId]);
  if (!rows[0]) throw fail("not_found");
  // 平台账号是机器身份：检索结果这类帖子的作者是它，不能变成谁的好友。
  if (rows[0].role === "platform") throw fail("bad_state");
  return rows[0];
}

export async function addFriend(pool, userId, friendId) {
  const friend = await friendUser(pool, friendId);
  if (friend.id === userId) throw fail("bad_state");
  await pool.query(`DELETE FROM friend_dismissals WHERE account_id = $1 AND friend_id = $2`, [userId, friendId]);
  await pool.query(
    `INSERT INTO friendships (account_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [userId, friendId]
  );
  return { friend: true };
}

export async function removeFriend(pool, userId, friendId) {
  const friend = await friendUser(pool, friendId);
  if (friend.id === userId) throw fail("bad_state");
  await pool.query(`DELETE FROM friendships WHERE account_id = $1 AND friend_id = $2`, [userId, friendId]);
  if (friend.role === "agent" && friend.side === "internal") {
    await pool.query(
      `INSERT INTO friend_dismissals (account_id, friend_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, friendId]
    );
  }
  return { friend: false };
}

export async function setCardFriend(pool, userId, intelId, friend) {
  const { rows } = await pool.query(
    `SELECT account_id FROM intel
     WHERE id = $1 AND ${visibleVerdict("verdict")} AND is_public AND kind IN ('post', 'fastpost')`,
    [intelId]
  );
  if (!rows[0]) throw fail("not_found");
  if (friend) return addFriend(pool, userId, rows[0].account_id);
  return removeFriend(pool, userId, rows[0].account_id);
}

export async function directMentions(pool, { authorId, intelId, kind, body, mentions }) {
  if (!mentions?.length) return;
  if (!MENTION_KINDS.has(kind)) throw fail("bad_mention");
  await assertFriends(pool, authorId, mentions);
  const text = toPlain(String(body || "")).replace(/\s+/g, " ").trim().slice(0, MENTION_BODY) || "一条信息";
  const href = kind === "wish" ? "/wish" : "/discover";
  for (const friendId of mentions) {
    const inserted = await pool.query(
      `INSERT INTO intel_mentions (intel_id, account_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING account_id`,
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
