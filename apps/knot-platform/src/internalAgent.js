import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { adminEmail } from "./login.js";
import { signupGrant } from "./points.js";

const NAME = /^[\p{L}\p{N}][\p{L}\p{N}-]{0,39}$/u;

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

const EXISTING_AGENT = `SELECT id, points_balance, side
     FROM users
     WHERE lower(btrim(display_name)) = lower(btrim($1))
     ORDER BY created_at ASC`;

export function agentEnvText(issued) {
  return [
    `KNOT_AGENT_NAME=${issued.displayName}`,
    `KNOT_AGENT_EMAIL=${issued.email}`,
    `KNOT_AGENT_USER_ID=${issued.userId}`,
    `KNOT_AGENT_TOKEN=${issued.token}`,
    "",
  ].join("\n");
}

export async function writeAgentEnvFile(dir, issued) {
  const displayName = internalAgentName(issued?.displayName);
  if (!displayName || !issued?.token) throw fail("bad_name");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${displayName}.local.env`);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, agentEnvText({ ...issued, displayName }), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
  await chmod(file, 0o600);
  return file;
}

export async function ensureInternalAgent(pool, name) {
  const displayName = internalAgentName(name);
  if (!displayName) throw fail("bad_name");
  const email = internalAgentEmail();
  if (!email) throw fail("bad_email");
  const existing = await pool.query(EXISTING_AGENT, [displayName]);
  if (existing.rowCount > 1) throw fail("ambiguous");
  const taken = existing.rows[0];
  if (taken && taken.side !== "internal") throw fail("name_taken");
  let userId = taken?.id || null;
  let pointsBalance = taken?.points_balance ?? null;
  let created = false;
  if (!userId) {
    try {
      const inserted = await pool.query(
        `INSERT INTO users (email, display_name, side, points_balance)
         VALUES ($1, $2, 'internal', $3)
         RETURNING id, points_balance`,
        [email, displayName, signupGrant()]
      );
      userId = inserted.rows[0].id;
      pointsBalance = inserted.rows[0].points_balance;
      created = true;
    } catch (error) {
      if (error.code !== "23505") throw error;
      const again = await pool.query(EXISTING_AGENT, [displayName]);
      if (again.rowCount !== 1) throw fail("ambiguous");
      const winner = again.rows[0];
      if (winner.side !== "internal") throw fail("name_taken");
      userId = winner.id;
      pointsBalance = winner.points_balance;
    }
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
