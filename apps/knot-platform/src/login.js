import { createHash, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { NAME_MAX } from "./account.js";
import { consumeInvite, findUsableInvite, normalizeInviteCode, recordInviteRedemption } from "./invites.js";
import { signupGrant } from "./points.js";
import { registrationMode } from "./system.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FEEDBACK_LABEL = { suggestion: "建议", complaint: "投诉" };
// 017 建的称呼唯一索引。注册撞上它时追加序号重试。
const DISPLAY_NAME_KEY = "users_display_name_key";

export const FEEDBACK_MAX = 2000;

export function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return null;
  return email;
}

// 注册时没有自带称呼，就用邮箱前缀兜底，保证称呼非空。前缀为空时用「用户」。
export function defaultDisplayName(email) {
  const local = String(email || "").split("@")[0].trim();
  return Array.from(local || "用户").slice(0, NAME_MAX).join("");
}

// 称呼被占用时追加序号，整串仍不超过 NAME_MAX 个字。
function numberedName(base, seq) {
  const suffix = ` ${seq}`;
  return Array.from(base).slice(0, NAME_MAX - Array.from(suffix).length).join("") + suffix;
}

export function normalizeLoginKey(value) {
  const key = String(value || "").trim().replace(/\s+/g, "");
  if (!/^\d{6}$/.test(key)) return null;
  return key;
}

export function newLoginKey() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
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

export async function requestLoginKey(pool, email, options = {}) {
  const recent = await pool.query(
    `SELECT 1 FROM login_keys WHERE email = $1 AND created_at > now() - interval '60 seconds' LIMIT 1`,
    [email]
  );
  if (recent.rowCount) return { error: "too_many", status: 429 };

  // 新邮箱才看注册策略；已有账户照常登录，不受邀请码和暂停注册影响。
  let inviteId = null;
  const existing = await pool.query(
    `SELECT 1 FROM users WHERE lower(email) = lower($1) AND side = 'external' LIMIT 1`,
    [email]
  );
  if (!existing.rows.length) {
    const mode = registrationMode();
    if (mode === "closed") return { error: "registration_closed", status: 403 };
    if (mode === "invite") {
      const code = normalizeInviteCode(options.inviteCode);
      if (!code) return { error: "invite_required", status: 400 };
      const invite = await findUsableInvite(pool, code);
      if (!invite) return { error: "bad_invite", status: 400 };
      inviteId = invite.id;
    }
  }

  const key = newLoginKey();
  const inserted = await pool.query(
    `INSERT INTO login_keys (email, key_hash, expires_at, invite_code_id)
     VALUES ($1, $2, now() + interval '10 minutes', $3)
     RETURNING id`,
    [email, hashLoginKey(key), inviteId]
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

// 真正写库的那一段，在调用方开好的事务里跑。
async function redeemOn(db, email, key) {
  const matched = await db.query(
    `UPDATE login_keys
     SET used_at = now()
     WHERE id = (
       SELECT id FROM login_keys
       WHERE email = $1 AND key_hash = $2 AND used_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC
       LIMIT 1
     )
     RETURNING id, invite_code_id`,
    [email, hashLoginKey(key)]
  );
  if (!matched.rowCount) return { error: "bad_key", status: 400 };

  const base = defaultDisplayName(email);
  for (let seq = 0; ; seq += 1) {
    const name = seq === 0 ? base : numberedName(base, seq);
    await db.query(`SAVEPOINT name_${seq}`);
    try {
      const saved = await db.query(
        `INSERT INTO users (email, display_name, points_balance) VALUES ($1, $2, $3)
         ON CONFLICT (lower(email)) WHERE email IS NOT NULL AND side = 'external'
         DO UPDATE SET email = EXCLUDED.email
         RETURNING id, points_balance, (xmax = 0) AS inserted`,
        [email, name, signupGrant()]
      );
      await db.query(`RELEASE SAVEPOINT name_${seq}`);
      const row = saved.rows[0];
      // 老账户直接登录；新账户才看注册策略。
      if (row.inserted === false) return { userId: row.id, pointsBalance: row.points_balance };

      const mode = registrationMode();
      if (mode === "closed") return { error: "registration_closed", status: 403 };
      if (mode === "invite") {
        const inviteId = matched.rows[0].invite_code_id;
        if (!inviteId) return { error: "invite_required", status: 400 };
        const consumed = await consumeInvite(db, inviteId);
        if (!consumed) return { error: "bad_invite", status: 400 };
        await recordInviteRedemption(db, { inviteId, userId: row.id, email });
      }
      return { userId: row.id, pointsBalance: row.points_balance };
    } catch (error) {
      // 只给称呼重名让路：换一个序号再插，其余唯一约束照常抛出。
      if (error.code !== "23505" || error.constraint !== DISPLAY_NAME_KEY || seq >= 1000) throw error;
      await db.query(`ROLLBACK TO SAVEPOINT name_${seq}`);
      await db.query(`RELEASE SAVEPOINT name_${seq}`);
    }
  }
}

export async function redeemLoginKey(pool, email, key) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await redeemOn(client, email, key);
    if (result && result.error) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // 已经回滚过时再回滚会失败，原错误仍然抛出。
    }
    throw error;
  } finally {
    client.release();
  }
}

export function adminEmail() {
  return normalizeEmail(process.env.KNOT_ADMIN_EMAIL);
}

// 人类管理员：External Personal Agent 账户的邮箱等于管理员邮箱时，其 WebUI 操作按平台层执行。
export async function isAdminUser(pool, userId) {
  if (!userId) return false;
  const { rows } = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
  return Boolean(rows[0]?.email) && rows[0].email === adminEmail();
}

export function feedbackMessage({ kind, accountEmail, userId, body }) {
  const label = FEEDBACK_LABEL[kind];
  return {
    subject: `Knot ${label}`,
    text: `类型：${label}\n账户：${accountEmail}\n用户：${userId}\n\n${body}\n`,
  };
}

export async function sendFeedback({ kind, accountEmail, userId, body }) {
  const to = adminEmail();
  const mail = mailTransport();
  if (!mail || !to || !FEEDBACK_LABEL[kind]) {
    const error = new Error("mail_unavailable");
    error.code = "mail_unavailable";
    throw error;
  }
  const message = feedbackMessage({ kind, accountEmail, userId, body });
  await mail.transport.sendMail({
    from: mail.from,
    to,
    replyTo: accountEmail,
    subject: message.subject,
    text: message.text,
  });
}

const EMAIL_FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'PingFang SC','Microsoft YaHei',sans-serif`;

function digitBoxes(key) {
  return [...key]
    .map(
      (digit) =>
        `<td style="width:48px;padding:0 4px;"><div style="height:56px;line-height:56px;background:#F7F8FA;border:1px solid #E4E6EB;border-radius:10px;color:#050505;font-size:28px;font-weight:700;text-align:center;font-family:${EMAIL_FONT};">${digit}</div></td>`
    )
    .join("");
}

export function loginKeyMessage(key) {
  return {
    subject: "Knot 登录密钥",
    text: `登录密钥：${key}\n\n六位数字，十分钟内有效。登录和注册用的是同一把密钥。\n\n如果不是你本人操作，请忽略这封邮件。`,
    html: `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Knot 登录密钥</title>
  </head>
  <body style="margin:0;padding:0;background:#F0F2F5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
            <tr>
              <td align="center" style="padding:0 0 24px;">
                <span style="font-family:${EMAIL_FONT};font-size:24px;font-weight:700;color:#0866FF;letter-spacing:0.5px;">Knot</span>
              </td>
            </tr>
            <tr>
              <td style="background:#FFFFFF;border:1px solid #E4E6EB;border-radius:12px;padding:40px 40px 32px;">
                <p style="margin:0 0 16px;font-family:${EMAIL_FONT};font-size:22px;font-weight:700;color:#050505;">你好，</p>
                <p style="margin:0 0 32px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:#65676B;">
                  感谢使用 Knot。用下面的登录密钥确认邮箱，登录和注册都用这一把密钥。
                </p>
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>${digitBoxes(key)}</tr>
                </table>
                <p style="margin:0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#65676B;text-align:center;">
                  六位数字，十分钟内有效，用过即废。
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 16px 0;">
                <p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#8A8D91;">
                  如果不是你本人操作，请忽略这封邮件。
                </p>
                <p style="margin:0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:#B0B3B8;">
                  需要帮助？回复这封邮件联系我们。
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}

export async function sendLoginKey(email, key) {
  const mail = mailTransport();
  if (!mail) {
    const error = new Error("mail_unavailable");
    error.code = "mail_unavailable";
    throw error;
  }
  const message = loginKeyMessage(key);
  await mail.transport.sendMail({
    from: mail.from,
    to: email,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
