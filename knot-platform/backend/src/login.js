import { createHash, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { NAME_MAX } from "./account.js";
import { consumeInvite, findUsableInvite, normalizeInviteCode, recordInviteRedemption } from "./invites.js";
import { signupGrant } from "./points.js";
import { registrationMode } from "./system.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FEEDBACK_LABEL = { suggestion: "建议", complaint: "投诉" };
// 称呼全局唯一（忽略大小写）。注册撞上它时追加序号重试。
const DISPLAY_NAME_KEY = "accounts_display_name_key";

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

// 登录码只有 6 位，一共 10^6 个取值，有效期 10 分钟。不限制试错次数的话，
// 知道邮箱的人可以在一个有效期内把空格基本走完——这不是猜测，是枚举。
//
// 计数落库（`login_failures`），按两个维度同时记：
//   (email, 客户端地址)  同一个地址对同一个邮箱的试错，5 次
//   (email, '')          这个邮箱被所有地址试错的总量，10 次
// 只用其中一个都绕得开：只按地址记，换 IP 就清零；只按邮箱记，看不出是谁在试。
// 任一维度到阈值就锁 15 分钟。
//
// 落库的代价是每次登录失败多一条写；换来的是重启不清零、多进程共享同一份计数。
// 锁触发时同时把该邮箱还没用的登录码作废：锁只挡入口，旧码本身还有效，留着就是
// 一条绕过锁的路。
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_IP_MAX_FAILURES = 5;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
const LOCK_SECONDS = Math.round(LOGIN_LOCK_MS / 1000);

// 「这个邮箱 + 这个地址」和「这个邮箱」是两行，ip = '' 的那行是后者。
// 拿不到客户端地址时（$2 = ''）按这个邮箱所有行里最晚的那个截止时刻算——宁可多挡。
const LOCK_SQL = `SELECT max(locked_until) AS until FROM login_failures
                   WHERE email = $1 AND ($2 = '' OR ip = $2 OR ip = '') AND locked_until > now()`;

// 一次失败一条：到阈值就把 attempts 归零、写下截止时刻，这样锁过期后从头算。
const NOTE_SQL = `INSERT INTO login_failures (email, ip, attempts, updated_at)
  VALUES ($1, $2, 1, now())
  ON CONFLICT (email, ip) DO UPDATE
     SET attempts = CASE WHEN login_failures.attempts + 1 >= $3 THEN 0
                         ELSE login_failures.attempts + 1 END,
         locked_until = CASE WHEN login_failures.attempts + 1 >= $3
                             THEN now() + make_interval(secs => $4)
                             ELSE login_failures.locked_until END,
         updated_at = now()
  RETURNING locked_until`;

const CLEAR_SQL = `DELETE FROM login_failures WHERE email = $1`;
// 只挑还没用过的：已经登录过的那把码留着 used_at，是它自己的历史。
const INVALIDATE_SQL = `UPDATE login_keys SET used_at = now() WHERE email = $1 AND used_at IS NULL`;

export async function loginLockRemaining(pool, email, ip = "") {
  const result = await pool.query(LOCK_SQL, [String(email || ""), String(ip || "")]);
  const until = result.rows[0]?.until;
  if (!until) return 0;
  return Math.max(0, new Date(until).getTime() - Date.now());
}

export async function clearLoginFailures(pool, email) {
  await pool.query(CLEAR_SQL, [String(email || "")]);
}

// 记一次「码不对」。返回锁定截止时刻（没锁就是 null）。
// 两个维度各记一条；地址为空（拿不到 req.ip）时只有邮箱那一行。
export async function noteLoginFailure(pool, email, ip = "") {
  const address = String(ip || "").trim();
  const scopes = address ? ["", address] : [""];
  let locked = null;
  for (const scope of scopes) {
    const threshold = scope ? LOGIN_IP_MAX_FAILURES : LOGIN_MAX_FAILURES;
    const result = await pool.query(NOTE_SQL, [String(email), scope, threshold, LOCK_SECONDS]);
    const until = result.rows[0]?.locked_until;
    if (until && (!locked || new Date(until) > new Date(locked))) locked = until;
  }
  if (locked) {
    await pool.query(INVALIDATE_SQL, [String(email)]);
    console.warn(
      `[login] ${email} 试错次数到上限，锁定到 ${new Date(locked).toISOString()}，未使用的登录码已作废`
    );
  }
  return locked;
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

// 委托发信：自己配 SMTP 送达不稳时，把纯文本交给联邦中枢代发（契约见
// xknot.si/docs/FEDERATION.md 第 7 节）。配了凭据就优先走它，不需要 SMTP 口令。
//
// 发信地址是协议的常量，能从 XKNOT_HUB_ORIGIN 推出来；显式写了 XKNOT_HUB_RELAY_URL
// 时以它为准（换中枢时用）。这样接入件里只有中枢地址和凭据两项。
export function relayUrl(env = process.env) {
  const explicit = String(env.XKNOT_HUB_RELAY_URL || "").trim();
  if (explicit) return explicit;
  const origin = String(env.XKNOT_HUB_ORIGIN || "")
    .trim()
    .replace(/\/+$/, "");
  if (!origin) return "";
  return `${origin}/api/federation/mail`;
}

function relayTransport() {
  const url = relayUrl();
  const token = String(process.env.XKNOT_HUB_RELAY_TOKEN || "").trim();
  if (!url || !token) return null;
  return {
    from: process.env.MAIL_FROM || process.env.SMTP_FROM || "",
    transport: {
      async sendMail(message) {
        let response;
        try {
          response = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ to: message.to, subject: message.subject, text: message.text }),
            signal: AbortSignal.timeout(30_000),
          });
        } catch (cause) {
          const error = new Error("relay_unreachable");
          error.code = "relay_unreachable";
          error.cause = cause;
          throw error;
        }
        if (!response.ok) {
          const error = new Error(`relay_${response.status}`);
          error.code = "relay_failed";
          error.status = response.status;
          throw error;
        }
        return response.json();
      },
    },
  };
}

export async function requestLoginKey(pool, email, options = {}) {
  const recent = await pool.query(
    `SELECT 1 FROM login_keys WHERE email = $1 AND created_at > now() - interval '60 seconds' LIMIT 1`,
    [email]
  );
  if (recent.rowCount) return { error: "too_many", status: 429 };

  // 新邮箱才看注册策略；已有账号照常登录，不受邀请码和暂停注册影响。
  let inviteId = null;
  const existing = await pool.query(
    `SELECT 1 FROM accounts WHERE lower(email) = lower($1) LIMIT 1`,
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

  // 主理人只认配置里的那一个邮箱；其余邮箱都是外部账号。
  // 正常启动时 ensureOwner 已经建好了主理人行，这里只处理「库比配置旧」的边角。
  const owner = await db.query(`SELECT id, email FROM accounts WHERE role = 'owner' LIMIT 1`);
  const registeringOwner = !owner.rows.length && email === adminEmail();

  const base = defaultDisplayName(email);
  for (let seq = 0; ; seq += 1) {
    const name = seq === 0 ? base : numberedName(base, seq);
    await db.query(`SAVEPOINT name_${seq}`);
    try {
      const saved = await db.query(
        `INSERT INTO accounts (role, side, email, display_name, points_balance)
         VALUES ($4, $5, $1, $2, $3)
         ON CONFLICT (lower(email)) WHERE email IS NOT NULL
         DO UPDATE SET email = EXCLUDED.email
         RETURNING id, points_balance, role, (xmax = 0) AS inserted`,
        [email, name, signupGrant(), registeringOwner ? "owner" : "user", registeringOwner ? "internal" : "external"]
      );
      await db.query(`RELEASE SAVEPOINT name_${seq}`);
      const row = saved.rows[0];
      // 老账号直接登录；新账号才看注册策略。
      if (row.inserted === false) return { userId: row.id, pointsBalance: row.points_balance, role: row.role };

      const mode = registrationMode();
      if (mode === "closed") return { error: "registration_closed", status: 403 };
      if (mode === "invite") {
        const inviteId = matched.rows[0].invite_code_id;
        if (!inviteId) return { error: "invite_required", status: 400 };
        const consumed = await consumeInvite(db, inviteId);
        if (!consumed) return { error: "bad_invite", status: 400 };
        await recordInviteRedemption(db, { inviteId, userId: row.id, email });
      }
      return { userId: row.id, pointsBalance: row.points_balance, role: row.role };
    } catch (error) {
      // 名额满了：库里触发器拦下来的，换成可翻译的错误码。
      if (error.code === "KN001" || error.code === "KN002" || error.code === "KN003") {
        await db.query(`ROLLBACK TO SAVEPOINT name_${seq}`);
        await db.query(`RELEASE SAVEPOINT name_${seq}`);
        return { error: "users_full", status: 403 };
      }
      // 只给称呼重名让路：换一个序号再插，其余唯一约束照常抛出。
      if (error.code !== "23505" || error.constraint !== DISPLAY_NAME_KEY || seq >= 1000) throw error;
      await db.query(`ROLLBACK TO SAVEPOINT name_${seq}`);
      await db.query(`RELEASE SAVEPOINT name_${seq}`);
    }
  }
}

export async function redeemLoginKey(pool, email, key, { ip = "" } = {}) {
  // 锁定期内不连库直接拒。失败计数记在事务外：下面的 ROLLBACK 会把事务里
  // 写下的任何东西一起丢掉，计数落在里面等于永远不涨。
  const remaining = await loginLockRemaining(pool, email, ip);
  if (remaining > 0) {
    return { error: "too_many", status: 429, retryAfter: Math.ceil(remaining / 1000) };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await redeemOn(client, email, key);
    if (result && result.error) await client.query("ROLLBACK");
    else await client.query("COMMIT");
    // 只把「码不对」算作一次失败：冻结注册、邀请码无效这些不是猜码，
    // 记进去会让正常用户在自己的注册窗口里被锁死。
    if (result && result.userId) await clearLoginFailures(pool, email);
    else if (result && result.error === "bad_key") await noteLoginFailure(pool, email, ip);
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

// 主理人账号：唯一，邮箱以 KNOT_ADMIN_EMAIL 为准。启动时调用，幂等。
// 邮箱改了就把主理人绑到新邮箱；主理人只有一个，不会因此多出第二个人。
export async function ensureOwner(pool) {
  const email = adminEmail();
  if (!email) return null;
  const existing = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
  if (existing.rows[0]) {
    try {
      await pool.query(
        `UPDATE accounts SET email = $2, updated_at = now()
          WHERE id = $1 AND lower(email) IS DISTINCT FROM lower($2)`,
        [existing.rows[0].id, email]
      );
    } catch (error) {
      // 改绑的主理人邮箱已经被别的账号注册过：这里不能静默挑一个赢家，
      // 否则那个人下次登录会以普通账号进站，而配置看上去是对的。
      if (error.code === "23505") {
        throw new Error(
          `KNOT_ADMIN_EMAIL=${email} 已经被另一个账号占用。主理人邮箱必须唯一：改配置，或先清掉那个账号。`
        );
      }
      throw error;
    }
    return existing.rows[0].id;
  }
  // 这个邮箱之前作为普通账号注册过：收回成主理人，内容与名下的 Agent 一并转内部。
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const promoted = await client.query(
      `UPDATE accounts SET role = 'owner', side = 'internal', updated_at = now()
        WHERE lower(email) = lower($1) AND role = 'user'
        RETURNING id`,
      [email]
    );
    if (promoted.rows[0]) {
      await client.query(
        `UPDATE accounts SET side = 'internal', updated_at = now()
          WHERE owner_id = $1 AND role = 'agent'`,
        [promoted.rows[0].id]
      );
      await client.query("COMMIT");
      return promoted.rows[0].id;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // 另一个进程刚好建好了主理人：以它为准，不把启动拖垮。
    if (error.code === "23505") {
      const again = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
      if (again.rows[0]) return again.rows[0].id;
    }
    throw error;
  } finally {
    client.release();
  }

  const base = defaultDisplayName(email);
  for (let seq = 0; seq < 50; seq += 1) {
    const name = seq === 0 ? base : numberedName(base, seq);
    try {
      const { rows } = await pool.query(
        `INSERT INTO accounts (role, side, email, display_name)
         VALUES ('owner', 'internal', $1, $2)
         RETURNING id`,
        [email, name]
      );
      return rows[0].id;
    } catch (error) {
      if (error.code !== "23505") throw error;
      // 另一个进程同时建好了主理人。
      const again = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
      if (again.rows[0]) return again.rows[0].id;
      // 称呼被占：换序号再试。其余冲突（邮箱已属于别的角色）说明库里有脏数据，不猜。
      if (error.constraint !== DISPLAY_NAME_KEY) throw error;
    }
  }
  throw new Error("owner_unavailable");
}

// 管理员 = 主理人账号。不再靠邮箱比较：角色就是权限。
export async function isOwnerAccount(pool, accountId) {
  if (!accountId) return false;
  const { rows } = await pool.query(`SELECT role FROM accounts WHERE id = $1`, [accountId]);
  return rows[0]?.role === "owner";
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
  const mail = relayTransport() || mailTransport();
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
