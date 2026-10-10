import { createHash, randomBytes, randomUUID } from "node:crypto";
import { normalizeEmail, isPlausibleEmail } from "./email.js";

const TOKEN_PREFIX = "knt_";

export function newAgentToken() {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

export function hashAgentToken(email, token) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${String(token || "").trim()}`)
    .digest("hex");
}

export async function authorizeAgent(pool, email, token) {
  const key = normalizeEmail(email);
  if (!key || !isPlausibleEmail(key)) throw authError("unauthorized");
  const raw = String(token || "").trim();
  if (!raw) throw authError("unauthorized");

  const { rows } = await pool.query(
    `SELECT t.token_id, t.user_id, t.status, u.email, u.status AS user_status
     FROM agent_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1`,
    [hashAgentToken(key, raw)]
  );
  const row = rows[0];
  if (!row || row.status !== "active") throw authError("unauthorized");
  if (normalizeEmail(row.email) !== key) throw authError("unauthorized");
  if (row.user_status !== "active") throw authError("unauthorized");

  await pool.query(
    "UPDATE agent_tokens SET last_used_at = now() WHERE token_id = $1",
    [row.token_id]
  );
  return { userId: row.user_id, email: key, tokenId: row.token_id };
}

function authError(code) {
  const e = new Error(code);
  e.status = 401;
  e.code = code;
  return e;
}

export async function issueAgentToken(pool, userId, email, label) {
  const token = newAgentToken();
  const tokenId = randomUUID();
  await pool.query(
    `INSERT INTO agent_tokens (token_id, user_id, token_hash, label, token_last4)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenId, userId, hashAgentToken(email, token), label || null, token.slice(-4)]
  );
  return { token, tokenId, tokenLast4: token.slice(-4) };
}
