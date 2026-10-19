import { randomInt } from "node:crypto";

// 邀请码不用 I、O、0、1，避免口头或截图传递时看错。
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NOTE_MAX = 200;
const USES_MAX = 10000;
const WINDOW_MAX_HOURS = 24 * 366;
const CODE_RE = /^[A-Z0-9]{4,32}$/;
const WINDOW_RE = /^(\d+)(h|d|w)$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function normalizeInviteCode(value) {
  const code = String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return CODE_RE.test(code) ? code : null;
}

export function newInviteCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i += 1) code += ALPHABET[randomInt(0, ALPHABET.length)];
  return code;
}

export function inviteWindow(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  const match = text.match(WINDOW_RE);
  if (!match) throw fail("bad_invite_expiry");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) throw fail("bad_invite_expiry");
  const hours = match[2] === "h" ? count : match[2] === "d" ? count * 24 : count * 168;
  if (hours > WINDOW_MAX_HOURS) throw fail("bad_invite_expiry");
  return hours;
}

function noteText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length > NOTE_MAX) throw fail("bad_invite_note");
  return text;
}

function useCount(value) {
  if (value == null || String(value).trim() === "") return 1;
  const text = typeof value === "number" ? String(value) : String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) throw fail("bad_invite_uses");
  const count = Number(text);
  if (!Number.isSafeInteger(count) || count > USES_MAX) throw fail("bad_invite_uses");
  return count;
}

export function presentInvite(row) {
  const expires = row.expires_at ? new Date(row.expires_at) : null;
  const disabled = Boolean(row.disabled_at);
  const expired = Boolean(expires && expires.getTime() <= Date.now());
  const remaining = Math.max(0, Number(row.max_uses) - Number(row.used_count));
  return {
    id: row.id,
    code: row.code,
    note: row.note || "",
    maxUses: Number(row.max_uses),
    usedCount: Number(row.used_count),
    remaining,
    expiresAt: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null,
    disabledAt: row.disabled_at ? new Date(row.disabled_at).toISOString() : null,
    usable: !disabled && !expired && remaining > 0,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

// 只读校验：请求登录密钥时用，先确认码能用，不在这一步扣次数。
export async function findUsableInvite(pool, code) {
  const normalized = normalizeInviteCode(code);
  if (!normalized) return null;
  const { rows } = await pool.query(
    `SELECT id FROM invite_codes
     WHERE code = $1
       AND disabled_at IS NULL
       AND used_count < max_uses
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

// 开新户时扣一次。并发下只有一个能扣到，扣不到就是码没了或过期了。
export async function consumeInvite(db, inviteId) {
  if (!inviteId) return null;
  const { rows } = await db.query(
    `UPDATE invite_codes
     SET used_count = used_count + 1
     WHERE id = $1
       AND disabled_at IS NULL
       AND used_count < max_uses
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING id, used_count, max_uses`,
    [inviteId]
  );
  return rows[0] || null;
}

export async function createInvite(pool, body = {}) {
  const rawCode = String(body.code ?? "").trim();
  const custom = rawCode ? normalizeInviteCode(rawCode) : null;
  if (rawCode && !custom) throw fail("bad_invite_code");
  const maxUses = useCount(body.maxUses);
  const note = noteText(body.note);
  const hours = inviteWindow(body.expiresIn);
  const expiresAt = hours ? new Date(Date.now() + hours * 60 * 60 * 1000) : null;

  // 自定义码只试一次；随机码撞了就换一个再试。
  const attempts = custom ? 1 : 6;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = custom || newInviteCode();
    try {
      const { rows } = await pool.query(
        `INSERT INTO invite_codes (code, note, max_uses, expires_at)
         VALUES ($1, $2, $3, $4)
         RETURNING id, code, note, max_uses, used_count, expires_at, disabled_at, created_at`,
        [code, note, maxUses, expiresAt]
      );
      return presentInvite(rows[0]);
    } catch (error) {
      if (error.code !== "23505") throw error;
    }
  }
  throw fail("code_taken");
}

export async function listInvites(pool, limit = 100) {
  const { rows } = await pool.query(
    `SELECT id, code, note, max_uses, used_count, expires_at, disabled_at, created_at
     FROM invite_codes
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map(presentInvite);
}

export async function disableInvite(pool, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""))) {
    throw fail("not_found");
  }
  const { rows } = await pool.query(
    `UPDATE invite_codes
     SET disabled_at = COALESCE(disabled_at, now())
     WHERE id = $1
     RETURNING id, code, note, max_uses, used_count, expires_at, disabled_at, created_at`,
    [id]
  );
  if (!rows.length) throw fail("not_found");
  return { ok: true, invite: presentInvite(rows[0]) };
}

export async function recordInviteRedemption(db, { inviteId, userId, email }) {
  await db.query(
    `INSERT INTO invite_redemptions (invite_id, user_id, email)
     VALUES ($1, $2, $3)
     ON CONFLICT (invite_id, user_id) DO NOTHING`,
    [inviteId, userId, email]
  );
}
