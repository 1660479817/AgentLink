import { createHash, randomInt } from "node:crypto";
import nodemailer from "nodemailer";
import { DEFAULT_SITE_LOCALE, parseLocale } from "@knot/locale";
import { NAME_MAX } from "./account.js";
import { consumeInvite, findUsableInvite, normalizeInviteCode, recordInviteRedemption } from "./invites.js";
import { signupGrant } from "./points.js";
import { LIMITS } from "./profile.js";
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
// 所以按邮箱记失败次数，超过阈值就锁一段时间；成功一次就清零。
//
// 为什么不落库：backend/migrations 只有一份基线，加表要整库重建（见 handoff.js）。
// 代价是重启清空计数。这是刻意的取舍：能重启实例的人已经有更高权限，
// 而把这张表塞进基线会让每台机器都得走一次结构变更。
// 单进程内计数在多副本部署下会各算各的；当前部署是单 Backend，先按这个前提。
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;
const MAX_GUARDED_EMAILS = 10_000;

// email -> { count, until }。until 是锁定截止时刻，0 表示没锁。
const guard = new Map();

function lockedUntil(email, now) {
  const entry = guard.get(email);
  if (!entry) return 0;
  if (!entry.until) return 0;
  if (entry.until > now) return entry.until;
  // 锁过期：整个条目作废，失败次数一起清掉，不带着旧账继续算。
  guard.delete(email);
  return 0;
}

export function loginLockRemaining(email, now = Date.now()) {
  const until = lockedUntil(String(email || ""), now);
  return until ? until - now : 0;
}

export function clearLoginFailures(email) {
  guard.delete(String(email || ""));
}

export function resetLoginGuard() {
  guard.clear();
}

function noteLoginFailure(email, now) {
  const until = lockedUntil(email, now);
  if (until) return; // 已经在锁里，不重复累计
  const entry = guard.get(email) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_FAILURES) {
    entry.count = 0;
    entry.until = now + LOGIN_LOCK_MS;
  }
  // 重新插入，把最近失败过的邮箱挪到表尾，淘汰时先丢最久没动的。
  guard.delete(email);
  guard.set(email, entry);
  while (guard.size > MAX_GUARDED_EMAILS) guard.delete(guard.keys().next().value);
}

function smtpSecureEnabled(env) {
  const value = String(env.SMTP_SECURE || "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function smtpFrom(env) {
  return String(env.MAIL_FROM || env.SMTP_FROM || "").trim();
}

// 本机 SMTP。主机与发信地址缺一不可：只有主机时发出去的信没有发信人，
// 多数收件方会拒收或判成垃圾，所以这种配置当作没配。
function smtpSender(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  const from = smtpFrom(env);
  if (!host || !from) return null;
  const user = String(env.SMTP_USER || "");
  const pass = String(env.SMTP_PASS || "");
  const transport = nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT || 587),
    secure: smtpSecureEnabled(env),
    auth: user ? { user, pass } : undefined,
  });
  return {
    // replyTo 由调用方给：反馈信要回到提交者的邮箱，登录密钥信不需要回信地址。
    send: ({ to, subject, text, html, replyTo }) =>
      transport.sendMail({ from, to, subject, text, html, replyTo: replyTo || undefined }),
  };
}

// 委托发信：自己配 SMTP 送达不稳、或不想在这台机器上放 SMTP 口令时，把纯文本
// 交给联邦中枢代发（契约见 xknot.si/docs/FEDERATION.md 第 7 节）。
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

// 中枢在 502 的正文里给两样东西：`smtp`（收信端的数字码加增强状态码，
// 例如 `421 4.7.28`）和 `transient`（值不值得等）。4xx 的时候还带
// `Retry-After`，那是收信端自己要的间隔。只读这几项，不读正文里的原话。
async function relayFailureOf(response) {
  let body = {};
  try {
    body = await response.json();
  } catch {
    // 网关的错误页不是 JSON：只剩状态码可用。
  }
  const header = Number(response.headers?.get?.("retry-after"));
  const hint = {
    hubError: typeof body?.error === "string" ? body.error : null,
    smtp: typeof body?.smtp === "string" ? body.smtp : null,
    transient: body?.transient === true,
    retryAfter: Number.isFinite(header) && header > 0 ? Math.round(header) : null,
  };
  return hint;
}

function relaySender(env = process.env) {
  const url = relayUrl(env);
  const token = String(env.XKNOT_HUB_RELAY_TOKEN || "").trim();
  if (!url || !token) return null;
  return {
    // 中枢只收 to / subject / text（可选 replyTo），html、附件、抄送一律丢弃，
    // 所以这里显式只取纯文本，别让调用方以为版面也会送出去。登录密钥不需要
    // 回信地址：省略 replyTo 时中枢按实例档案的 contact 填。
    async send({ to, subject, text }) {
      let response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ to, subject, text }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (cause) {
        const error = new Error("relay_unreachable");
        error.code = "relay_unreachable";
        error.cause = cause;
        throw error;
      }
      if (!response.ok) {
        // 只报 `relay_502` 等于把 421 的「慢一点」和 550 的「地址没了」压成同一句话，
        // 运维在日志里分不出来，也就没法判断该等还是该改收件人。
        const error = new Error(`relay_${response.status}`);
        error.code = "relay_failed";
        error.status = response.status;
        Object.assign(error, await relayFailureOf(response));
        throw error;
      }
      return response.json();
    },
  };
}

// 一条能写进日志的判定：通道、收信端的码、要不要等。不带收件地址、不带正文。
function describeMailError(error) {
  const code = Number(error?.responseCode);
  const enhanced = /(?:^|\s)([245]\.\d{1,3}\.\d{1,3})(?:\s|$)/.exec(String(error?.response || ""))?.[1];
  const fromSmtp = Number.isInteger(code) && code >= 100 && code <= 599 ? (enhanced ? `${code} ${enhanced}` : String(code)) : "";
  const smtp = String(error?.smtp || "").trim() || fromSmtp;
  return [
    error?.code || error?.message || "mail_failed",
    smtp,
    error?.retryAfter ? `retry-after ${error.retryAfter}s` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * 这台机器实际能用哪种发信方式，按优先级给一个值：
 *   relay —— 有中枢地址和凭据，登录密钥优先走中枢；
 *   smtp  —— 有 SMTP 主机和发信地址；
 *   none  —— 一样都没有，登录密钥寄不出去。
 * 管理后台的排障面板与真实发信读同一个函数，面板说能发就是真能发。
 */
export function mailChannel(env = process.env) {
  if (relayUrl(env) && String(env.XKNOT_HUB_RELAY_TOKEN || "").trim()) return "relay";
  if (String(env.SMTP_HOST || "").trim() && smtpFrom(env)) return "smtp";
  return "none";
}

function mailUnavailable() {
  const error = new Error("mail_unavailable");
  error.code = "mail_unavailable";
  return error;
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
    await sendLoginKey(email, key, options.site);
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

export async function redeemLoginKey(pool, email, key) {
  // 锁定期内不连库直接拒。失败计数记在事务外：下面的 ROLLBACK 会把事务里
  // 写下的任何东西一起丢掉，计数落在里面等于永远不涨。
  const remaining = loginLockRemaining(email);
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
    if (result && result.userId) clearLoginFailures(email);
    else if (result && result.error === "bad_key") noteLoginFailure(email, Date.now());
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

export function feedbackMessage({ kind, accountEmail, userId, body, site = "" }) {
  const label = FEEDBACK_LABEL[kind];
  return {
    subject: `${site || "Knot"} ${label}`,
    text: `类型：${label}\n账户：${accountEmail}\n用户：${userId}\n\n${body}\n`,
  };
}

/**
 * 建议与投诉寄给站点的管理邮箱。
 *
 * 这条只走本机 SMTP，不交给中枢代发：代发的额度是登录密钥的命根子，
 * 一个用户连发几十条就能把当天的登录密钥挤掉；而且代发要求 Reply-To 落在
 * 实例自己的域名，这里要回到提交者本人的邮箱，本来就过不了那道校验。
 * 没配 SMTP 时如实返回 mail_unavailable，不假装发出去了。
 */
export async function sendFeedback({ kind, accountEmail, userId, body, site = "" }) {
  const to = adminEmail();
  const mail = smtpSender();
  if (!mail || !to || !FEEDBACK_LABEL[kind]) throw mailUnavailable();
  const message = feedbackMessage({ kind, accountEmail, userId, body, site });
  try {
    await mail.send({ to, replyTo: accountEmail, subject: message.subject, text: message.text });
  } catch (error) {
    // 这一条只走本机 SMTP，失败时页面上只说「没寄出」；判定得留在日志里，
    // 否则 421 的流控和 550 的地址错在运维眼里是同一件事。
    console.error(`[mail] 建议与投诉没有寄出（${describeMailError(error)}）`);
    throw error;
  }
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

// 登录密钥信的文案。语种跟着站点档案走（登录前不知道是谁，只可能是站点默认），
// 站点名、地址与联系方式是变量，其余是常量。代发只收纯文本，所以 text 必须自己
// 站得住：站点名、地址、联系方式、有效期、忽略提示一项都不能只在 html 里。
const LOGIN_MAIL = {
  "zh-CN": {
    subject: (site) => `${site} 登录密钥`,
    hello: "你好，",
    intro: (site) => `感谢使用 ${site}。用下面的登录密钥确认邮箱，登录和注册都用这一把密钥。`,
    ttl: "十分钟内有效，用过即废。",
    ttlText: "十分钟内有效，只能用一次。登录和注册用的是同一把。",
    siteLine: (site, url) => `站点：${site}${url ? `  ${url}` : ""}`,
    ignore: "如果不是你本人操作，请忽略这封邮件。",
    ignoreText: "如果不是你本人操作，请忽略这封邮件，不要把上面的数字告诉任何人。",
    contactLine: (contact) => `需要帮助？联系 ${contact}`,
    relay: (site) => `本邮件由 XKnot 联邦代 ${site} 发出。`,
  },
  "zh-TW": {
    subject: (site) => `${site} 登入金鑰`,
    hello: "你好，",
    intro: (site) => `感謝使用 ${site}。用下面的登入金鑰確認電子郵件，登入和註冊都用這一把金鑰。`,
    ttl: "十分鐘內有效，用過即廢。",
    ttlText: "十分鐘內有效，只能用一次。登入和註冊用的是同一把。",
    siteLine: (site, url) => `站點：${site}${url ? `  ${url}` : ""}`,
    ignore: "如果不是你本人操作，請忽略這封郵件。",
    ignoreText: "如果不是你本人操作，請忽略這封郵件，不要把上面的數字告訴任何人。",
    contactLine: (contact) => `需要協助？聯絡 ${contact}`,
    relay: (site) => `本郵件由 XKnot 聯邦代 ${site} 發出。`,
  },
  en: {
    subject: (site) => `Your ${site} sign-in key`,
    hello: "Hello,",
    intro: (site) =>
      `Thanks for using ${site}. Confirm your email with the sign-in key below; the same key covers sign-in and sign-up.`,
    ttl: "Valid for ten minutes, single use.",
    ttlText: "Valid for ten minutes, single use. The same key covers sign-in and sign-up.",
    siteLine: (site, url) => `Site: ${site}${url ? `  ${url}` : ""}`,
    ignore: "If you did not request this, ignore this email.",
    ignoreText: "If you did not request this, ignore this message and do not share the number with anyone.",
    contactLine: (contact) => `Need help? Contact ${contact}`,
    relay: (site) => `This message was sent by the XKnot federation on behalf of ${site}.`,
  },
};

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// 站点名来自主理人填的档案，进 HTML 前必须转义，否则一个档案就能往信里塞标签。
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

// 只把收件人真能打开的地址写进信里。本机地址（127.0.0.1、localhost）和单段主机名
// 点不开，写进去只会让人以为这封是测试信，索性整行省掉。
function publicSiteUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (!host.includes(".") || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * 把站点档案收成信里要用的四项。`url` 是调用方从 KNOT_PUBLIC_ORIGIN 取来的对外地址。
 *
 * 站点名与联系方式都是主理人填的自由文本：档案允许换行，而主题里一个换行会让中枢
 * 拒收整封信（SMTP 头里也不该出现换行），所以这里先压成一行再按档案上限截断。
 * 地址只认配置，不取请求的 Host：Host 可被伪造，等于让实例往信里写一个
 * 攻击者控制的域名。
 */
function loginMailSite(site = {}) {
  const source = site || {};
  return {
    name: singleLine(source.name, LIMITS.name) || "Knot",
    locale: parseLocale(source.locale) || DEFAULT_SITE_LOCALE,
    url: publicSiteUrl(source.url),
    contact: singleLine(source.contact, LIMITS.contact),
  };
}

// 压成一行并按码点截断：换行会破坏主题与排版，超长的值不该撑破信纸。
function singleLine(value, max) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return text ? [...text].slice(0, max).join("") : "";
}

function loginKeyText(copy, { key, name, url, contact, relayed }) {
  const lines = [copy.subject(name), "", key, "", copy.ttlText, "", copy.siteLine(name, url)];
  if (contact) lines.push(copy.contactLine(contact));
  if (relayed) lines.push(copy.relay(name));
  lines.push("", copy.ignoreText);
  return lines.join("\n");
}

function loginKeyHtml(copy, { key, name, url, contact, relayed, locale }) {
  const footer = [
    `<p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#65676B;">${escapeHtml(
      copy.siteLine(name, url)
    )}</p>`,
  ];
  if (contact) {
    footer.push(
      `<p style="margin:0 0 8px;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#8A8D91;">${escapeHtml(
        copy.contactLine(contact)
      )}</p>`
    );
  }
  footer.push(
    `<p style="margin:0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#8A8D91;">${escapeHtml(copy.ignore)}</p>`
  );
  if (relayed) {
    footer.push(
      `<p style="margin:8px 0 0;font-family:${EMAIL_FONT};font-size:12px;line-height:1.6;color:#B0B3B8;">${escapeHtml(
        copy.relay(name)
      )}</p>`
    );
  }
  return `<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(copy.subject(name))}</title>
  </head>
  <body style="margin:0;padding:0;background:#F0F2F5;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;">
      <tr>
        <td align="center" style="padding:36px 16px;">
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">
            <tr>
              <td align="center" style="padding:0 0 24px;">
                <span style="font-family:${EMAIL_FONT};font-size:24px;font-weight:700;color:#0866FF;letter-spacing:0.5px;">${escapeHtml(
                  name
                )}</span>
              </td>
            </tr>
            <tr>
              <td style="background:#FFFFFF;border:1px solid #E4E6EB;border-radius:12px;padding:40px 40px 32px;">
                <p style="margin:0 0 16px;font-family:${EMAIL_FONT};font-size:22px;font-weight:700;color:#050505;">${escapeHtml(
                  copy.hello
                )}</p>
                <p style="margin:0 0 32px;font-family:${EMAIL_FONT};font-size:15px;line-height:1.6;color:#65676B;">
                  ${escapeHtml(copy.intro(name))}
                </p>
                <table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>${digitBoxes(key)}</tr>
                </table>
                <p style="margin:0;font-family:${EMAIL_FONT};font-size:13px;line-height:1.6;color:#65676B;text-align:center;">
                  ${escapeHtml(copy.ttl)}
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 16px 0;">
                ${footer.join("\n                ")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * 一封登录密钥信。两个通道共用这一份：端侧 SMTP 发 text + html，
 * 联邦代发只把 subject 与 text 交出去，版面不出实例。
 * 所以加变量时先加进 text，html 只做增强。
 */
export function loginKeyMessage(key, site = {}, { relayed = false } = {}) {
  const { name, locale, url, contact } = loginMailSite(site);
  const copy = LOGIN_MAIL[locale];
  const vars = { key, name, url, contact, relayed, locale };
  return {
    subject: copy.subject(name),
    text: loginKeyText(copy, vars),
    html: loginKeyHtml(copy, vars),
  };
}

/**
 * 寄登录密钥：有委托凭据先走中枢，失败且本机 SMTP 也在时兜底。
 *
 * 兜底是必要的：只有委托一条路的实例，中枢停发信或当天额度用完时，
 * 全站登录会一起断。同一次请求里两封信用的是同一把密钥，重复投递也
 * 只是多一封码相同的信，不影响可用性；真正发不出去时照常抛错，
 * 由 requestLoginKey 删掉那条没用上的密钥。
 */
export async function sendLoginKey(email, key, site = {}) {
  const relay = relaySender();
  let smtp = null;
  if (relay) {
    try {
      await relay.send({ to: email, ...loginKeyMessage(key, site, { relayed: true }) });
      return;
    } catch (error) {
      smtp = smtpSender();
      if (!smtp) {
        // 只剩这一条路：把收信端的判定打出来，不然运维只看到一句
        // 「登录接口 503」，不知道是 421 让我们慢一点还是 550 地址被拒。
        console.error(`[mail] 委托发信失败，且没有本机 SMTP 可回退（${describeMailError(error)}）`);
        throw error;
      }
      // 只记通道与错误码：收件地址和密钥都不该进日志。
      console.warn(`[mail] 委托发信失败（${describeMailError(error)}），改走本机 SMTP`);
    }
  }
  smtp = smtp || smtpSender();
  if (!smtp) throw mailUnavailable();
  try {
    await smtp.send({ to: email, ...loginKeyMessage(key, site) });
  } catch (error) {
    // 两条路都没寄出去：这里记下本机 SMTP 的判定，也一样不带地址。
    console.error(`[mail] 本机 SMTP 也没有寄出（${describeMailError(error)}）`);
    throw error;
  }
}
