import { timingSafeEqual } from "node:crypto";
import { recordNotification } from "./notifications.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITHIN = /^(\d+)(h|d|w)$/;
const REASON_MAX = 500;
const REPORT_MAX = 2000;
const RECENT_LIMIT = 30;
const WINDOW_LIMIT = 200;
const WITHIN_MAX_HOURS = 24 * 366;

function fail(code, extra) {
  const error = new Error(code);
  error.code = code;
  if (extra) Object.assign(error, extra);
  return error;
}

export function isLoopbackAddress(address) {
  const ip = String(address || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

export function bearerToken(header) {
  const match = String(header || "").match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : "";
}

export function tokensMatch(expected, presented) {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(presented || ""));
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function clipText(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function requireText(value, max, code) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) throw fail(code);
  return text;
}

function likeNeedle(value) {
  return `%${String(value).replace(/[%_\\]/g, "")}%`;
}

function presentAccount(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    label: row.label || "",
  };
}

function presentPost(row) {
  return {
    id: row.id,
    body: clipText(row.body, 400),
    verdict: row.verdict,
    public: row.is_public !== false,
    createdAt: row.created_at,
  };
}

export async function findUsers(pool, query) {
  const q = clipText(query, 200);
  if (!q) throw fail("bad_user");
  if (UUID.test(q)) {
    const { rows } = await pool.query(
      `SELECT id, email, display_name, label FROM users WHERE id = $1`,
      [q]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT id, email, display_name, label
     FROM users
     WHERE lower(email) = lower($1) OR display_name = $1
     ORDER BY created_at ASC
     LIMIT 6`,
    [q]
  );
  return rows;
}

async function oneUser(pool, query) {
  const rows = await findUsers(pool, query);
  if (!rows.length) throw fail("not_found");
  if (rows.length > 1) throw fail("ambiguous", { users: rows.map(presentAccount) });
  return rows[0];
}

export async function searchUsers(pool, query) {
  const q = clipText(query, 200);
  if (!q) throw fail("bad_user");
  if (UUID.test(q)) {
    const rows = await findUsers(pool, q);
    return rows.map(presentAccount);
  }
  const { rows } = await pool.query(
    `SELECT id, email, display_name, label
     FROM users
     WHERE email ILIKE $1 OR display_name ILIKE $1 OR label = $2
     ORDER BY created_at DESC
     LIMIT 20`,
    [likeNeedle(q), q]
  );
  return rows.map(presentAccount);
}

export function hoursWithin(value) {
  if (value == null || String(value).trim() === "") return null;
  const match = String(value).trim().toLowerCase().match(WITHIN);
  if (!match) throw fail("bad_within");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) throw fail("bad_within");
  const hours = match[2] === "h" ? count : match[2] === "d" ? count * 24 : count * 168;
  if (hours > WITHIN_MAX_HOURS) throw fail("bad_within");
  return { hours, within: `${count}${match[2]}` };
}

export async function listPosts(pool, { user, q, within }) {
  const account = await oneUser(pool, user);
  const window = hoursWithin(within);
  const needle = clipText(q, 200);
  const params = [account.id];
  let sql = `SELECT id, body, verdict, is_public, created_at, count(*) OVER () AS total
             FROM intel
             WHERE user_id = $1`;
  if (window) {
    params.push(window.hours);
    sql += ` AND created_at >= now() - make_interval(hours => $${params.length}::int)`;
  }
  if (needle) {
    params.push(likeNeedle(needle));
    sql += ` AND body ILIKE $${params.length}`;
  }
  params.push(window ? WINDOW_LIMIT : RECENT_LIMIT);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return {
    user: presentAccount(account),
    within: window ? window.within : null,
    total: rows.length ? Number(rows[0].total) : 0,
    posts: rows.map(presentPost),
  };
}

async function writeAction(pool, { action, userId = null, intelId = null, body }) {
  await pool.query(
    `INSERT INTO admin_actions (action, user_id, intel_id, body) VALUES ($1, $2, $3, $4)`,
    [action, userId, intelId, body]
  );
}

export async function removePost(pool, id, reason) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const text = requireText(reason, REASON_MAX, "bad_body");
  const { rows } = await pool.query(
    `UPDATE intel
     SET verdict = 'removed', reject_reason = $2, is_public = false
     WHERE id = $1 AND verdict <> 'removed'
     RETURNING id, user_id`,
    [id, text]
  );
  if (!rows.length) {
    const existing = await pool.query(`SELECT id FROM intel WHERE id = $1 AND verdict = 'removed'`, [id]);
    if (!existing.rows.length) throw fail("not_found");
    return { ok: true, already: true, id };
  }
  await recordNotification(pool, {
    userId: rows[0].user_id,
    kind: "intel_removed",
    title: "帖子已删除",
    body: text,
    href: "/mine/submissions",
  });
  await writeAction(pool, { action: "remove", userId: rows[0].user_id, intelId: id, body: text });
  return { ok: true, already: false, id, userId: rows[0].user_id };
}

export async function warnUser(pool, user, body) {
  const account = await oneUser(pool, user);
  const text = requireText(body, REASON_MAX, "bad_body");
  await recordNotification(pool, {
    userId: account.id,
    kind: "warning",
    title: "平台警告",
    body: text,
  });
  await writeAction(pool, { action: "warn", userId: account.id, body: text });
  return { ok: true, user: presentAccount(account) };
}

export async function patrolQueue(pool) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.created_at, u.id AS user_id, u.email, u.display_name
     FROM intel i
     JOIN users u ON u.id = i.user_id
     WHERE i.verdict = 'passed'
       AND i.is_public
       AND i.created_at > COALESCE(
         (SELECT max(created_at) FROM admin_actions WHERE action = 'patrol'),
         now() - interval '1 day'
       )
     ORDER BY i.created_at ASC
     LIMIT 40`
  );
  return {
    posts: rows.map((row) => ({
      id: row.id,
      body: clipText(row.body, 400),
      createdAt: row.created_at,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name || "",
      },
    })),
  };
}

export async function recordPatrol(pool, body) {
  const text = requireText(body, REPORT_MAX, "bad_body");
  await writeAction(pool, { action: "patrol", body: text });
  return { ok: true };
}
