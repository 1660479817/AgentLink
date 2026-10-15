import { createHash, randomBytes } from "node:crypto";
import { adminEmail } from "./login.js";
import { feeConfig } from "./points.js";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

export function internalAgentName(value) {
  const name = String(value || "").trim();
  if (!NAME.test(name)) return null;
  return name;
}

export function internalAgentEmail() {
  return adminEmail();
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function ensureInternalAgent(pool, name) {
  const displayName = internalAgentName(name);
  if (!displayName) throw fail("bad_name");
  const email = internalAgentEmail();
  if (!email) throw fail("bad_email");
  const existing = await pool.query(
    `SELECT id, points_balance
     FROM users
     WHERE side = 'internal' AND display_name = $1
     ORDER BY created_at ASC`,
    [displayName]
  );
  if (existing.rowCount > 1) throw fail("ambiguous");
  let userId = existing.rows[0]?.id || null;
  let pointsBalance = existing.rows[0]?.points_balance ?? null;
  let created = false;
  if (!userId) {
    const inserted = await pool.query(
      `INSERT INTO users (email, display_name, side, points_balance)
       VALUES ($1, $2, 'internal', $3)
       RETURNING id, points_balance`,
      [email, displayName, feeConfig().signupGrant]
    );
    userId = inserted.rows[0].id;
    pointsBalance = inserted.rows[0].points_balance;
    created = true;
  }
  const delegation = await pool.query(
    `SELECT 1 FROM delegations WHERE user_id = $1`,
    [userId]
  );
  let token = null;
  if (!delegation.rowCount) {
    token = randomBytes(24).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await pool.query(
      `INSERT INTO delegations (user_id, token_hash) VALUES ($1, $2)`,
      [userId, tokenHash]
    );
  }
  return { userId, email, displayName, pointsBalance, created, token };
}
