import { createHash, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { feeConfig } from "./points.js";

const KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  return email;
}

export function normalizeLoginKey(value) {
  const key = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z2-9]{8}$/.test(key)) return null;
  return key;
}

export function newLoginKey() {
  let key = "";
  for (let i = 0; i < 8; i += 1) key += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  return key;
}

export function hashLoginKey(key) {
  return createHash("sha256").update(key).digest("hex");
}

function smtpSecureEnabled() {
  const value = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function mailTransport() {
  const host = process.env.SMTP_HOST || "";
  const from = process.env.MAIL_FROM || process.env.SMTP_FROM || "";
  if (!host || !from) return null;
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  return {
    from,
    transport: nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: smtpSecureEnabled(),
      auth: user ? { user, pass } : undefined,
    }),
  };
}

export async function requestLoginKey(pool, email) {
  const recent = await pool.query(
    `SELECT 1 FROM login_keys WHERE email = $1 AND created_at > now() - interval '60 seconds' LIMIT 1`,
    [email]
  );
  if (recent.rowCount) return { error: "too_many", status: 429 };
  const key = newLoginKey();
  const inserted = await pool.query(
    `INSERT INTO login_keys (email, key_hash, expires_at)
     VALUES ($1, $2, now() + interval '10 minutes')
     RETURNING id`,
    [email, hashLoginKey(key)]
  );
  try {
    await sendLoginKey(email, key);
  } catch (err) {
    await pool.query(`DELETE FROM login_keys WHERE id = $1`, [inserted.rows[0].id]);
    const code = err.code === "mail_unavailable" ? "mail_unavailable" : "mail_failed";
    return { error: code, status: 503 };
  }
  return { ok: true };
}

export async function redeemLoginKey(pool, email, key) {
  const matched = await pool.query(
    `UPDATE login_keys
     SET used_at = now()
     WHERE id = (
       SELECT id FROM login_keys
       WHERE email = $1 AND key_hash = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING id`,
    [email, hashLoginKey(key)]
  );
  if (!matched.rowCount) return { error: "bad_key", status: 400 };
  const saved = await pool.query(
    `INSERT INTO users (email, points_balance) VALUES ($1, $2)
     ON CONFLICT (lower(email)) WHERE email IS NOT NULL
     DO UPDATE SET email = EXCLUDED.email
     RETURNING id, points_balance`,
    [email, feeConfig().signupGrant]
  );
  return { userId: saved.rows[0].id, pointsBalance: saved.rows[0].points_balance };
}

export async function sendLoginKey(email, key) {
  const mail = mailTransport();
  if (!mail) {
    const error = new Error("mail_unavailable");
    error.code = "mail_unavailable";
    throw error;
  }
  await mail.transport.sendMail({
    from: mail.from,
    to: email,
    subject: "Knot 登录密钥",
    text: `登录密钥：${key}\n\n十分钟内有效。登录和注册用的是同一把密钥。`,
  });
}
