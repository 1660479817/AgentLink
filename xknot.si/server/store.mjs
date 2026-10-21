// 申请与管理员账号的存储。
//
// 用 Node 自带的 node:sqlite，不留外部依赖；库文件放在 var/，不入版本库。
// 这一层只做读写，不判断业务，也不碰 HTTP。

import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { subdomainUrl } from "./validate.mjs";

const SCHEMA = `
create table if not exists applications (
  id           text primary key,
  name         text not null,
  -- 两种接入模式：own-domain（自有域名）或 subdomain（中枢签发）。
  mode         text,
  -- 自有域名模式的地址（https://example.com）；subdomain 模式为 NULL。
  domain       text,
  -- subdomain 模式的标签；own-domain 模式为 NULL。
  subdomain    text,
  -- 对外地址，创建时由模式推出，之后不再变。
  url          text not null,
  operator     text not null,
  email        text not null,
  region       text not null,
  timezone     text not null,
  intro        text not null,
  tags         text not null default '[]',
  locale       text,
  status       text not null default 'pending',
  created_at   text not null,
  reviewed_at  text,
  reviewed_by  text,
  review_note  text,
  ip_hash      text,
  -- 可选服务（委托发信、橱窗、统计）。不影响接入模式。
  request_services text,
  proof_method     text,
  proof_at         text,
  public_key       text,
  -- 案例页的能力键：明文存放，因为每次补信都要重新拼出同一个地址。
  -- 它只在一个申请单内有效，泄露等同于泄露该申请单的收件箱。
  case_key         text,
  -- 每次状态迁移 +1，和事件一起作为发信幂等键。
  state_version    integer not null default 0,
  verified_at      text,
  contact_verified_at text,
  hold_items       text,
  reject_reason    text,
  open_until       text,
  closed_at        text
);

create index if not exists applications_status on applications(status, created_at);
create index if not exists applications_url on applications(url);

-- 邮箱验证令牌：库里只有 SHA-256，明文随信发出，24~720 小时过期，用一次作废。
create table if not exists verify_tokens (
  token_hash    text primary key,
  application_id text not null,
  created_at    text not null,
  expires_at    text not null,
  used_at       text
);

create index if not exists verify_tokens_application on verify_tokens(application_id);

-- 一次性领取令牌：交付资料（委托发信凭据等）只在这里留一份，取一次即作废。
create table if not exists claim_tokens (
  id             text primary key,
  token_hash     text not null unique,
  application_id text not null,
  payload        text not null,
  created_at     text not null,
  expires_at     text not null,
  used_at        text,
  created_by     text
);

create index if not exists claim_tokens_application on claim_tokens(application_id);

-- 发信日志：不存正文、不存完整地址。状态迁移类事件靠 (event, case_id, state_version)
-- 唯一索引去重；运营类事件 state_version 为 NULL，SQLite 视作互不相等，可以补发。
create table if not exists notify_log (
  seq          integer primary key autoincrement,
  at           text not null,
  event        text not null,
  case_id      text,
  state_version integer,
  locale       text,
  to_domain    text,
  to_hash      text,
  template_version text,
  status       text not null,
  error        text
);

create unique index if not exists notify_once
  on notify_log(event, case_id, state_version);
create index if not exists notify_case on notify_log(case_id, at);

create table if not exists admins (
  id            text primary key,
  username      text not null unique,
  password_hash text not null,
  created_at    text not null,
  last_login_at text
);

create table if not exists sessions (
  token_hash text primary key,
  admin_id   text not null,
  created_at text not null,
  expires_at text not null
);

create table if not exists events (
  seq    integer primary key autoincrement,
  at     text not null,
  kind   text not null,
  ref    text,
  detail text
);

-- 委托发信：一份凭据绑定一个实例，可单独吊销、单独定额度。
create table if not exists relay_tokens (
  id           text primary key,
  instance_id  text not null,
  label        text,
  token_hash   text not null unique,
  daily_limit  integer not null default 50,
  created_at   text not null,
  created_by   text,
  revoked_at   text,
  last_used_at text
);

create index if not exists relay_tokens_instance on relay_tokens(instance_id);

-- 只记域名与结果，不存收件地址和正文；删掉日志不影响任何实例。
create table if not exists relay_log (
  seq          integer primary key autoincrement,
  at           text not null,
  instance_id  text not null,
  token_id     text,
  to_domain    text,
  to_hash      text,
  subject_len  integer,
  idem_key     text,
  status       text not null,
  error        text
);

create index if not exists relay_log_instance on relay_log(instance_id, at);
create index if not exists relay_log_token on relay_log(token_id, at);

-- 成员入口：邮箱收一次性授权码，10 分钟有效。库里只留哈希，明文只在信里。
-- 一个邮箱同时只有最新一枚有效码：重新发信会把上一枚作废。
create table if not exists member_codes (
  code_hash   text primary key,
  email       text not null,
  instance_id text not null,
  created_at  text not null,
  expires_at  text not null,
  attempts    integer not null default 0,
  used_at     text
);

create index if not exists member_codes_email on member_codes(email, created_at);

-- 成员会话与管理员会话分开：浏览器可能同时是访客和运营者，
-- 一个 Cookie 失效不该把另一个踢掉。
create table if not exists member_sessions (
  token_hash  text primary key,
  email       text not null,
  instance_id text not null,
  created_at  text not null,
  expires_at  text not null
);

create index if not exists member_sessions_email on member_sessions(email, created_at);
`;

// 依赖迁移补出来的列的索引，必须在 migrate() 之后建：
// 老库先跑这一段会报 no such column: case_key，库就打不开了。
const INDEXES = `
create index if not exists applications_case on applications(case_key);
`;

export const STATUSES = [
  "pending",
  "verified",
  "hold",
  "approved",
  "rejected",
  "withdrawn",
  "expired",
];

// 申请单的状态机。审核通过只代表「可以收录」，与实例是否接通无关。
const TRANSITIONS = {
  pending: ["verified", "withdrawn", "expired"],
  verified: ["hold", "approved", "rejected", "withdrawn"],
  hold: ["verified", "approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
  expired: [],
};

const TERMINAL_STATUSES = new Set(["approved", "rejected", "withdrawn", "expired"]);

// 允许通过 transition() 一起写回的列。用映射表挡住任意列名拼接。
const APPLICATION_PATCH_COLUMNS = {
  reviewedAt: "reviewed_at",
  reviewedBy: "reviewed_by",
  reviewNote: "review_note",
  verifiedAt: "verified_at",
  holdItems: "hold_items",
  rejectReason: "reject_reason",
};

// 老库是 create table if not exists 建出来的，新列不会自己长出来。
// 这里只做加法：加列、补索引，不动已有数据。
const APPLICATION_COLUMNS = [
  ["mode", "text"],
  ["domain", "text"],
  ["subdomain", "text"],
  ["request_services", "text"],
  ["proof_method", "text"],
  ["proof_at", "text"],
  ["public_key", "text"],
  ["case_key", "text"],
  ["state_version", "integer not null default 0"],
  ["verified_at", "text"],
  ["contact_verified_at", "text"],
  ["hold_items", "text"],
  ["reject_reason", "text"],
  ["open_until", "text"],
  ["closed_at", "text"],
];

function migrate(db) {
  const existing = new Set(db.prepare("pragma table_info(applications)").all().map((row) => row.name));
  for (const [name, type] of APPLICATION_COLUMNS) {
    if (existing.has(name)) continue;
    db.exec(`alter table applications add column ${name} ${type}`);
  }
  // 老申请没有案例键，补一个；否则案例页与补信都没有入口。
  const missing = db
    .prepare("select id from applications where case_key is null or case_key = ''")
    .all();
  const fill = db.prepare("update applications set case_key = ? where id = ?");
  for (const row of missing) fill.run(randomBytes(9).toString("base64url"), row.id);
  // state_version 在旧行上是 NULL 时也给个 0，幂等键才稳定。
  db.exec("update applications set state_version = 0 where state_version is null");
  // 旧库只有 url 与 subdomain 的区分：有标签就是 subdomain 模式，否则是自有域名。
  db.exec(`
    update applications
       set mode = case when subdomain is not null and subdomain <> '' then 'subdomain' else 'own-domain' end
     where mode is null or mode = ''
  `);
  db.exec(`
    update applications
       set domain = url
     where (domain is null or domain = '')
       and mode = 'own-domain'
       and url is not null
       and url not like 'https://%.xknot.si'
  `);
}

function nowIso() {
  return new Date().toISOString();
}

function addDays(days, from = new Date()) {
  return new Date(from.getTime() + days * 86400000).toISOString();
}

function jsonList(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

// 申请编号：给人念得出来的短号，不暴露序号。
export function newApplicationId(at = new Date()) {
  const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ"; // 去掉 I O
  const bytes = randomBytes(6);
  let body = "";
  for (const byte of bytes) body += alphabet[byte % alphabet.length];
  return `XK-${at.getUTCFullYear()}-${body}`;
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltText, hashText] = String(stored).split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, "base64");
  const expected = Buffer.from(hashText, "base64");
  const actual = scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function ipHash(ip, secret = "xknot") {
  return sha256(`${secret}|${ip}`).slice(0, 16);
}

export function openStore(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // 目录通常已是 0700，库文件再收一道，避免备份或临时复制时被其他用户读到。
  if (file !== ":memory:") {
    try {
      chmodSync(file, 0o600);
    } catch {
      // 文件系统不支持时靠目录权限。
    }
  }
  db.exec("pragma journal_mode = wal");
  db.exec("pragma busy_timeout = 5000");
  db.exec("pragma foreign_keys = on");
  db.exec(SCHEMA);
  migrate(db);
  db.exec(INDEXES);

  const get = (sql, ...params) => db.prepare(sql).get(...params);
  const all = (sql, ...params) => db.prepare(sql).all(...params);

  function event(kind, ref, detail) {
    db.prepare("insert into events (at, kind, ref, detail) values (?, ?, ?, ?)").run(
      nowIso(),
      kind,
      ref ?? null,
      detail == null ? null : String(detail)
    );
  }

  function rowToApplication(row) {
    if (!row) return null;
    // 老库没有 mode 列：有标签按 subdomain，没有就是自有域名。
    const mode = row.mode || (row.subdomain ? "subdomain" : "own-domain");
    const subdomain = mode === "subdomain" ? row.subdomain || null : null;
    const domain = mode === "own-domain" ? row.domain || row.url : null;
    return {
      id: row.id,
      name: row.name,
      mode,
      domain,
      subdomain,
      url: mode === "subdomain" ? subdomainUrl(subdomain) : domain,
      operator: row.operator,
      email: row.email,
      region: row.region,
      timezone: row.timezone,
      intro: row.intro,
      tags: jsonList(row.tags),
      locale: row.locale || null,
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
      reviewNote: row.review_note,
      // ---- 接入模式与状态机 ----
      requestServices: jsonList(row.request_services),
      publicKey: row.public_key || null,
      caseKey: row.case_key || null,
      stateVersion: Number(row.state_version) || 0,
      verifiedAt: row.verified_at || null,
      contactVerifiedAt: row.contact_verified_at || null,
      holdItems: jsonList(row.hold_items),
      rejectReason: row.reject_reason || null,
      openUntil: row.open_until || null,
      closedAt: row.closed_at || null,
    };
  }

  return {
    file,
    db,
    close() {
      db.close();
    },

    // ---- 申请 ----

    // 同一个地址只允许一条未结案的申请。approved 之后放行：
    // 伙伴要补服务或换地址时得能再交一张单。
    findOpenBySubdomain(subdomain) {
      const label = String(subdomain || "").trim();
      if (!label) return null;
      return rowToApplication(
        get(
          `select * from applications
            where (subdomain = ? or url = ?)
              and status in ('pending', 'verified', 'hold')
            order by created_at desc limit 1`,
          label,
          subdomainUrl(label)
        )
      );
    },

    findOpenByDomain(domain) {
      const url = String(domain || "").trim();
      if (!url) return null;
      return rowToApplication(
        get(
          `select * from applications
            where (mode = 'own-domain' or mode is null)
              and url = ?
              and status in ('pending', 'verified', 'hold')
            order by created_at desc limit 1`,
          url
        )
      );
    },

    findByCaseKey(caseKey) {
      const key = String(caseKey || "").trim();
      if (!key) return null;
      return rowToApplication(get("select * from applications where case_key = ?", key));
    },

    // 任意状态的申请都算。补记历史实例时用它判断「这张单是不是已经有了」，
    // 已结案的也要算：再补一张会让同一个站点有两份申请。
    findByUrl(url) {
      const target = String(url || "").trim().replace(/\/+$/, "");
      if (!target) return null;
      return rowToApplication(
        get("select * from applications where url = ? or url = ? order by created_at desc limit 1", target, `${target}/`)
      );
    },

    createApplication(input) {
      const createdAt = nowIso();
      const id = newApplicationId(new Date(createdAt));
      const caseKey = randomBytes(9).toString("base64url");
      const mode = input.mode === "own-domain" ? "own-domain" : "subdomain";
      const subdomain = mode === "subdomain" ? String(input.subdomain || "").trim() : null;
      const domain = mode === "own-domain" ? String(input.domain || "").trim() : null;
      const url = input.url || (mode === "subdomain" ? subdomainUrl(subdomain) : domain);
      db.prepare(
        `insert into applications
          (id, name, mode, domain, subdomain, url, operator, email, region, timezone, intro, tags, locale, status, created_at, ip_hash,
           request_services, case_key, state_version, open_until)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, 0, ?)`
      ).run(
        id,
        input.name,
        mode,
        domain,
        subdomain,
        url,
        input.operator,
        input.email,
        input.region,
        input.timezone,
        input.intro,
        JSON.stringify(input.tags || []),
        input.locale || null,
        createdAt,
        input.ipHash || null,
        JSON.stringify(input.requestServices || []),
        caseKey,
        addDays(30)
      );
      event("application.submitted", id, input.locale || null);
      return this.getApplication(id);
    },

    getApplication(id) {
      return rowToApplication(get("select * from applications where id = ?", String(id)));
    },

    listApplications({ status = null, limit = 200 } = {}) {
      const capped = Math.min(Math.max(Number(limit) || 200, 1), 500);
      const rows = status
        ? all(
            "select * from applications where status = ? order by created_at desc limit ?",
            status,
            capped
          )
        : all("select * from applications order by created_at desc limit ?", capped);
      return rows.map(rowToApplication);
    },

    countsByStatus() {
      const out = { pending: 0, verified: 0, approved: 0, rejected: 0, hold: 0, withdrawn: 0, expired: 0 };
      for (const row of all("select status, count(*) as n from applications group by status")) {
        out[row.status] = row.n;
      }
      return out;
    },

    // 最久一条还没结束的申请。审核台用它提示“已经压了多久”。
    oldestOpenAt() {
      const row = get(
        "select created_at from applications where status in ('pending', 'verified', 'hold') order by created_at asc limit 1"
      );
      return row?.created_at || null;
    },

    // 发信概况：只统计窗口内的事件，不返回收件地址与正文。
    notifyStats(sinceIso) {
      const row =
        get(
          `select count(*) as total,
             sum(case when status = 'sent' then 1 else 0 end) as sent,
             sum(case when status = 'failed' then 1 else 0 end) as failed,
             sum(case when status = 'throttled' then 1 else 0 end) as throttled,
             max(at) as last_at
           from notify_log where at >= ?`,
          String(sinceIso)
        ) || {};
      return {
        total: Number(row.total) || 0,
        sent: Number(row.sent) || 0,
        failed: Number(row.failed) || 0,
        throttled: Number(row.throttled) || 0,
        lastAt: row.last_at || null,
      };
    },

    relayStats(sinceIso) {
      const row =
        get(
          `select count(*) as total,
             sum(case when status = 'accepted' then 1 else 0 end) as accepted,
             sum(case when status = 'failed' then 1 else 0 end) as failed,
             max(at) as last_at
           from relay_log where at >= ?`,
          String(sinceIso)
        ) || {};
      return {
        total: Number(row.total) || 0,
        accepted: Number(row.accepted) || 0,
        failed: Number(row.failed) || 0,
        lastAt: row.last_at || null,
      };
    },

    // 状态迁移的唯一入口：版本号 +1，供发信幂等使用。
    // 允许的迁移集中在 TRANSITIONS，越界一律 invalid_transition。
    transition({ id, to, patch = {}, admin = null, eventKind = null }) {
      const current = this.getApplication(id);
      if (!current) return { error: "not_found" };
      const allowed = TRANSITIONS[current.status] || [];
      if (!allowed.includes(to)) {
        return { error: "invalid_transition", from: current.status, to };
      }
      const fields = ["status = ?", "state_version = state_version + 1"];
      const values = [to];
      for (const [key, column] of Object.entries(APPLICATION_PATCH_COLUMNS)) {
        if (!Object.hasOwn(patch, key)) continue;
        fields.push(`${column} = ?`);
        const value = patch[key];
        values.push(Array.isArray(value) ? JSON.stringify(value) : value ?? null);
      }
      if (TERMINAL_STATUSES.has(to)) {
        fields.push("closed_at = ?");
        values.push(nowIso());
      }
      values.push(current.id);
      db.prepare(`update applications set ${fields.join(", ")} where id = ?`).run(...values);
      event(eventKind || `application.${to}`, current.id, admin || null);
      return { application: this.getApplication(current.id) };
    },

    // 审核：approved / rejected / hold 从 verified 或 hold 进入；
    // resume 把 hold 送回 verified。已结案的再改一律拒绝。
    reviewApplication({ id, decision, note = "", items = [], reason = null, admin }) {
      const target = {
        approve: "approved",
        reject: "rejected",
        hold: "hold",
        resume: "verified",
      }[decision];
      if (!target) return { error: "invalid_decision" };
      return this.transition({
        id,
        to: target,
        admin,
        patch: {
          reviewedAt: nowIso(),
          reviewedBy: admin,
          reviewNote: String(note || "").slice(0, 500),
          ...(decision === "hold" ? { holdItems: items } : {}),
          ...(decision === "reject" ? { rejectReason: reason || "incomplete" } : {}),
        },
      });
    },

    // 邮箱验证：pending → verified，顺便记下时间。
    markEmailVerified(id) {
      return this.transition({
        id,
        to: "verified",
        patch: { verifiedAt: nowIso() },
        eventKind: "application.verified",
      });
    },

    markContactVerified(id) {
      const current = this.getApplication(id);
      if (!current) return { error: "not_found" };
      db.prepare("update applications set contact_verified_at = ?, state_version = state_version + 1 where id = ?")
        .run(nowIso(), current.id);
      event("application.contact_verified", current.id, null);
      return { application: this.getApplication(current.id) };
    },

    withdrawApplication(id) {
      return this.transition({
        id,
        to: "withdrawn",
        eventKind: "application.withdrawn",
        patch: { reviewedAt: nowIso() },
      });
    },

    setPublicKey({ id, publicKey }) {
      const current = this.getApplication(id);
      if (!current) return { error: "not_found" };
      db.prepare("update applications set public_key = ?, state_version = state_version + 1 where id = ?")
        .run(String(publicKey).slice(0, 1000), current.id);
      event("application.public_key", current.id, null);
      return { application: this.getApplication(current.id) };
    },

    // pending 超过 open_until 自动结束。approved 之后不再过期。
    expireApplications(now = nowIso()) {
      const rows = all(
        "select id from applications where status = 'pending' and open_until is not null and open_until < ?",
        String(now)
      );
      for (const row of rows) {
        db.prepare(
          "update applications set status = 'expired', closed_at = ?, state_version = state_version + 1 where id = ?"
        ).run(now, row.id);
        event("application.expired", row.id, null);
      }
      return rows.length;
    },

    // ---- 邮箱验证令牌 ----

    // 每次补发都换一份新的，旧的未使用令牌一并作废。
    issueVerifyToken({ applicationId, ttlHours = 720 }) {
      const current = this.getApplication(applicationId);
      if (!current) return { error: "not_found" };
      const token = randomBytes(32).toString("base64url");
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
      db.prepare("delete from verify_tokens where application_id = ? and used_at is null").run(current.id);
      db.prepare(
        "insert into verify_tokens (token_hash, application_id, created_at, expires_at, used_at) values (?, ?, ?, ?, null)"
      ).run(sha256(token), current.id, createdAt, expiresAt);
      event("verify.issued", current.id, null);
      return { token, applicationId: current.id, expiresAt };
    },

    // 页面在用户点「确认」之前先看一眼令牌属于谁，只为拿对语种。
    // 不消费、不改状态；令牌本身仍是秘密，查看不需要额外鉴权。
    verifyTokenApplication(token) {
      const row = get("select application_id from verify_tokens where token_hash = ?", sha256(String(token || "")));
      return row ? this.getApplication(row.application_id) : null;
    },

    // 消费令牌：过期的、用过的、不存在的分开报，页面才能给出准确的说明。
    // 顺带把申请推进到 verified；状态已经不是 pending 时只返回当前状态，
    // 让页面能解释「已经验证过了」或「申请已结束」。
    consumeVerifyToken(token) {
      const hash = sha256(String(token || ""));
      const row = get("select * from verify_tokens where token_hash = ?", hash);
      if (!row) return { error: "not_found" };
      if (row.used_at) return { error: "already_used" };
      if (Date.parse(row.expires_at) <= Date.now()) return { error: "expired" };
      const current = this.getApplication(row.application_id);
      if (!current) return { error: "not_found" };
      if (current.status !== "pending" && current.status !== "verified") {
        return { error: "closed", application: current };
      }
      db.prepare("update verify_tokens set used_at = ? where token_hash = ?").run(nowIso(), hash);
      if (current.status === "pending") {
        return { application: this.markEmailVerified(current.id).application, token: row, transitioned: true };
      }
      return { application: current, token: row, transitioned: false };
    },

    // ---- 一次性领取令牌 ----

    createClaimToken({ applicationId, payload, ttlHours = 72, createdBy = null }) {
      const current = this.getApplication(applicationId);
      if (!current) return { error: "not_found" };
      const token = randomBytes(32).toString("base64url");
      const id = `clm_${randomBytes(6).toString("hex")}`;
      const createdAt = nowIso();
      const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
      db.prepare(
        `insert into claim_tokens (id, token_hash, application_id, payload, created_at, expires_at, used_at, created_by)
         values (?, ?, ?, ?, ?, ?, null, ?)`
      ).run(id, sha256(token), current.id, String(payload), createdAt, expiresAt, createdBy);
      event("claim.issued", current.id, id);
      return { id, token, expiresAt, applicationId: current.id };
    },

    consumeClaimToken(token) {
      const hash = sha256(String(token || ""));
      const row = get("select * from claim_tokens where token_hash = ?", hash);
      if (!row) return { error: "not_found" };
      if (row.used_at) return { error: "already_used" };
      if (Date.parse(row.expires_at) <= Date.now()) return { error: "expired" };
      db.prepare("update claim_tokens set used_at = ? where token_hash = ?").run(nowIso(), hash);
      event("claim.consumed", row.application_id, row.id);
      return { payload: row.payload, applicationId: row.application_id, id: row.id };
    },

    // ---- 发信日志 ----

    // 先把这条事件占住再发信：状态迁移类事件有唯一索引，重复触发只会返回 duplicate。
    beginNotify({ event: name, caseId = null, stateVersion = null, locale = null, toDomain = null, toHash = null, templateVersion = null }) {
      const at = nowIso();
      try {
        const result = db
          .prepare(
            `insert into notify_log (at, event, case_id, state_version, locale, to_domain, to_hash, template_version, status, error)
             values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', null)`
          )
          .run(
            at,
            String(name),
            caseId ? String(caseId) : null,
            Number.isInteger(stateVersion) ? stateVersion : null,
            locale ? String(locale).slice(0, 12) : null,
            toDomain ? String(toDomain).slice(0, 253) : null,
            toHash ? String(toHash).slice(0, 32) : null,
            templateVersion ? String(templateVersion) : null
          );
        return { id: Number(result.lastInsertRowid), at };
      } catch (error) {
        if (/UNIQUE|constraint/i.test(String(error?.message || ""))) return { duplicate: true };
        throw error;
      }
    },

    finishNotify(id, { status, error = null } = {}) {
      if (!["sent", "failed", "skipped", "throttled"].includes(status)) return 0;
      const result = db
        .prepare("update notify_log set status = ?, error = ? where seq = ? and status = 'pending'")
        .run(String(status), error ? String(error).slice(0, 120) : null, Number(id));
      return Number(result.changes) || 0;
    },

    notifySentFor(caseId, name, stateVersion) {
      const row = get(
        "select status from notify_log where event = ? and case_id = ? and state_version = ? and status = 'sent'",
        String(name),
        String(caseId),
        Number(stateVersion)
      );
      return Boolean(row);
    },

    listNotifyLog(limit = 50, caseId = null) {
      const capped = Math.min(Math.max(Number(limit) || 50, 1), 500);
      const rows = caseId
        ? all(
            "select * from notify_log where case_id = ? order by seq desc limit ?",
            String(caseId),
            capped
          )
        : all("select * from notify_log order by seq desc limit ?", capped);
      return rows.map((row) => ({
        seq: Number(row.seq),
        at: row.at,
        event: row.event,
        caseId: row.case_id,
        stateVersion: row.state_version == null ? null : Number(row.state_version),
        locale: row.locale,
        toDomain: row.to_domain,
        templateVersion: row.template_version,
        status: row.status,
        error: row.error,
      }));
    },

    pruneNotifyLog(days = 90) {
      const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 90) * 86400000).toISOString();
      const result = db.prepare("delete from notify_log where at < ?").run(cutoff);
      return Number(result.changes) || 0;
    },

    // ---- 管理员 ----

    createAdmin({ username, password }) {
      const name = String(username || "").trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(name)) return { error: "invalid_username" };
      if (String(password || "").length < 10) return { error: "weak_password" };
      if (get("select id from admins where username = ?", name)) return { error: "exists" };

      const id = `adm_${randomBytes(8).toString("hex")}`;
      db.prepare(
        "insert into admins (id, username, password_hash, created_at) values (?, ?, ?, ?)"
      ).run(id, name, hashPassword(password), nowIso());
      event("admin.created", id, name);
      return { admin: { id, username: name } };
    },

    listAdmins() {
      return all("select id, username, created_at, last_login_at from admins order by username").map(
        (row) => ({
          id: row.id,
          username: row.username,
          createdAt: row.created_at,
          lastLoginAt: row.last_login_at,
        })
      );
    },

    deleteAdmin(username) {
      const row = get("select id from admins where username = ?", String(username || "").toLowerCase());
      if (!row) return { error: "not_found" };
      const total = get("select count(*) as n from admins").n;
      if (total <= 1) return { error: "last_admin" };
      db.prepare("delete from admins where id = ?").run(row.id);
      db.prepare("delete from sessions where admin_id = ?").run(row.id);
      event("admin.deleted", row.id, username);
      return { ok: true };
    },

    verifyAdmin({ username, password }) {
      const row = get("select * from admins where username = ?", String(username || "").trim().toLowerCase());
      if (!row) return null;
      if (!verifyPassword(password, row.password_hash)) return null;
      db.prepare("update admins set last_login_at = ? where id = ?").run(nowIso(), row.id);
      return { id: row.id, username: row.username };
    },

    // 忘密码时重设：旧会话一并作废，逼所有人重新登录。
    setPassword(username, password) {
      const row = get("select id, username from admins where username = ?", String(username || "").trim().toLowerCase());
      if (!row) return { error: "not_found" };
      if (String(password || "").length < 10) return { error: "weak_password" };
      db.prepare("update admins set password_hash = ? where id = ?").run(hashPassword(password), row.id);
      db.prepare("delete from sessions where admin_id = ?").run(row.id);
      event("admin.password_reset", row.id, row.username);
      return { admin: row };
    },

    // ---- 会话 ----

    createSession(adminId, days = 7) {
      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + days * 86400000);
      db.prepare(
        "insert into sessions (token_hash, admin_id, created_at, expires_at) values (?, ?, ?, ?)"
      ).run(sha256(token), adminId, createdAt.toISOString(), expiresAt.toISOString());
      return { token, expiresAt: expiresAt.toISOString() };
    },

    sessionAdmin(token) {
      if (!token) return null;
      const row = get("select * from sessions where token_hash = ?", sha256(token));
      if (!row) return null;
      if (Date.parse(row.expires_at) <= Date.now()) {
        db.prepare("delete from sessions where token_hash = ?").run(row.token_hash);
        return null;
      }
      const admin = get("select id, username from admins where id = ?", row.admin_id);
      return admin ? { id: admin.id, username: admin.username } : null;
    },

    deleteSession(token) {
      if (!token) return;
      db.prepare("delete from sessions where token_hash = ?").run(sha256(token));
    },

    pruneSessions() {
      db.prepare("delete from sessions where expires_at <= ?").run(nowIso());
    },

    // ---- 委托发信 ----

    // 明文只在创建时返回一次；库里只有 SHA-256。
    createRelayToken({ instanceId, label = "", dailyLimit = 50, createdBy = null }) {
      const id = String(instanceId || "").trim();
      if (!/^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/.test(id)) return { error: "invalid_instance" };
      const limit = Math.min(Math.max(Number(dailyLimit) || 50, 1), 5000);
      const token = `xkr_${id}_${randomBytes(24).toString("base64url")}`;
      const recordId = `rtk_${randomBytes(6).toString("hex")}`;
      db.prepare(
        `insert into relay_tokens (id, instance_id, label, token_hash, daily_limit, created_at, created_by)
         values (?, ?, ?, ?, ?, ?, ?)`
      ).run(recordId, id, String(label || "").slice(0, 80), sha256(token), limit, nowIso(), createdBy);
      event("relay.token_created", recordId, id);
      return {
        token,
        record: { id: recordId, instanceId: id, label: String(label || ""), dailyLimit: limit },
      };
    },

    listRelayTokens() {
      return all(
        `select id, instance_id, label, daily_limit, created_at, created_by, revoked_at, last_used_at
         from relay_tokens order by created_at desc`
      ).map((row) => ({
        id: row.id,
        instanceId: row.instance_id,
        label: row.label || "",
        dailyLimit: Number(row.daily_limit) || 0,
        createdAt: row.created_at,
        createdBy: row.created_by,
        revokedAt: row.revoked_at,
        lastUsedAt: row.last_used_at,
      }));
    },

    verifyRelayToken(token) {
      if (typeof token !== "string" || !token) return { error: "missing" };
      const row = get("select * from relay_tokens where token_hash = ?", sha256(token));
      if (!row) return { error: "invalid" };
      if (row.revoked_at) return { error: "revoked" };
      db.prepare("update relay_tokens set last_used_at = ? where id = ?").run(nowIso(), row.id);
      return {
        token: {
          id: row.id,
          instanceId: row.instance_id,
          label: row.label || "",
          dailyLimit: Number(row.daily_limit) || 0,
        },
      };
    },

    // 吊销：给记录 id 只吊销这一份，给实例 id 吊销该实例下所有未吊销的凭据。
    revokeRelayToken(ref) {
      const value = String(ref || "").trim();
      if (!value) return { error: "not_found" };
      const byId = get("select id, instance_id from relay_tokens where id = ? and revoked_at is null", value);
      const rows = byId
        ? [byId]
        : all("select id, instance_id from relay_tokens where instance_id = ? and revoked_at is null", value);
      if (!rows.length) return { error: "not_found" };

      const at = nowIso();
      const stmt = db.prepare("update relay_tokens set revoked_at = ? where id = ?");
      for (const row of rows) stmt.run(at, row.id);
      event("relay.token_revoked", rows[0].id, `${byId ? "token" : "instance"}:${value}`);
      return { revoked: rows.length, at, instanceId: rows[0].instance_id };
    },

    // 24 小时窗口内成功、失败与在途都算一次：在途先占住额度，避免并发请求
    // 同时通过检查后一起发信。
    relayUsage(tokenId, sinceIso) {
      const row = get(
        `select count(*) as n from relay_log
         where token_id = ? and at >= ? and status in ('pending', 'accepted', 'failed')`,
        String(tokenId),
        String(sinceIso)
      );
      return Number(row?.n) || 0;
    },

    // 在同一个写事务里查幂等键、查额度和占位。Node 是单线程，但发信要 await，
    // 检查与写入之间必须没有 await，否则两个请求会同时看到“还有余额”。
    // 返回 { id, at } 表示已占位，{ duplicate } 表示同键已有在途或成功记录，
    // { error: "quota_exceeded" } 表示额度已满。
    reserveRelay({
      instanceId,
      tokenId,
      sinceIso,
      limit,
      toDomain = null,
      toHash = null,
      subjectLength = null,
      idemKey = null,
    }) {
      const capped = Math.min(Math.max(Number(limit) || 50, 1), 5000);
      db.exec("begin immediate");
      try {
        if (idemKey) {
          const hit = get(
            `select seq, at, status from relay_log
             where token_id = ? and idem_key = ? and at >= ? and status in ('pending', 'accepted')
             order by seq desc limit 1`,
            String(tokenId),
            String(idemKey),
            String(sinceIso)
          );
          if (hit) {
            db.exec("commit");
            return {
              duplicate: {
                id: Number(hit.seq),
                at: hit.at,
                pending: hit.status === "pending",
              },
            };
          }
        }

        const used = Number(
          get(
            `select count(*) as n from relay_log
             where token_id = ? and at >= ? and status in ('pending', 'accepted', 'failed')`,
            String(tokenId),
            String(sinceIso)
          )?.n
        ) || 0;
        if (used >= capped) {
          db.exec("commit");
          return { error: "quota_exceeded", used, limit: capped };
        }

        const at = nowIso();
        const result = db
          .prepare(
            `insert into relay_log (at, instance_id, token_id, to_domain, to_hash, subject_len, idem_key, status, error)
             values (?, ?, ?, ?, ?, ?, ?, 'pending', null)`
          )
          .run(
            at,
            String(instanceId),
            String(tokenId),
            toDomain ? String(toDomain).slice(0, 253) : null,
            toHash ? String(toHash).slice(0, 32) : null,
            Number.isInteger(subjectLength) ? subjectLength : null,
            idemKey ? String(idemKey).slice(0, 64) : null
          );
        db.exec("commit");
        return { id: Number(result.lastInsertRowid), at };
      } catch (error) {
        try {
          db.exec("rollback");
        } catch {
          // 事务可能已经结束，交给上层处理原始错误。
        }
        throw error;
      }
    },

    finishRelay(id, { status, error = null } = {}) {
      if (status !== "accepted" && status !== "failed") return 0;
      const result = db
        .prepare("update relay_log set status = ?, error = ? where seq = ? and status = 'pending'")
        .run(String(status), error ? String(error).slice(0, 120) : null, Number(id));
      return Number(result.changes) || 0;
    },

    findRelayDelivery(tokenId, idemKey, sinceIso) {
      if (!idemKey) return null;
      const row = get(
        `select seq, at from relay_log
         where token_id = ? and idem_key = ? and status = 'accepted' and at >= ?
         order by seq desc limit 1`,
        String(tokenId),
        String(idemKey),
        String(sinceIso)
      );
      return row ? { id: Number(row.seq), at: row.at } : null;
    },

    logRelay({ instanceId, tokenId = null, toDomain = null, toHash = null, subjectLength = null, idemKey = null, status, error = null }) {
      const result = db
        .prepare(
          `insert into relay_log (at, instance_id, token_id, to_domain, to_hash, subject_len, idem_key, status, error)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          nowIso(),
          String(instanceId),
          tokenId ? String(tokenId) : null,
          toDomain ? String(toDomain).slice(0, 253) : null,
          toHash ? String(toHash).slice(0, 32) : null,
          Number.isInteger(subjectLength) ? subjectLength : null,
          idemKey ? String(idemKey).slice(0, 64) : null,
          String(status),
          error ? String(error).slice(0, 120) : null
        );
      return Number(result.lastInsertRowid) || null;
    },

    listRelayLog(limit = 50) {
      return all(
        "select seq, at, instance_id, to_domain, subject_len, status, error from relay_log order by seq desc limit ?",
        Math.min(Math.max(Number(limit) || 50, 1), 500)
      ).map((row) => ({
        seq: Number(row.seq),
        at: row.at,
        instanceId: row.instance_id,
        toDomain: row.to_domain,
        subjectLength: row.subject_len,
        status: row.status,
        error: row.error,
      }));
    },

    pruneRelayLog(days = 30) {
      const cutoff = new Date(Date.now() - Math.max(1, Number(days) || 30) * 86400000).toISOString();
      const result = db.prepare("delete from relay_log where at < ?").run(cutoff);
      return Number(result.changes) || 0;
    },

    // 进程在发信途中退出会留下 pending 占位。SMTP 超时是 45 秒，15 分钟足够；
    // 不清掉的话，这条占位会一直占着 24 小时额度。
    pruneStaleRelayPending(minutes = 15) {
      const cutoff = new Date(Date.now() - Math.max(1, Number(minutes) || 15) * 60000).toISOString();
      const result = db
        .prepare("delete from relay_log where status = 'pending' and at < ?")
        .run(cutoff);
      return Number(result.changes) || 0;
    },

    // ---- 成员入口 ----
    //
    // 只认审核通过且邮箱已验证的申请：那是这个站点对外的正式联系地址。
    // 一个邮箱可能对应多条历史申请，按时间倒序全部返回，由接口层挑在册的那条。
    memberApplications(email) {
      const address = String(email || "").trim().toLowerCase();
      if (!address) return [];
      return all(
        "select * from applications where lower(email) = ? and status = 'approved' order by created_at desc",
        address
      ).map(rowToApplication);
    },

    // 六位数字码，明文只在返回值里出现一次，库里是 SHA-256。
    // 同一邮箱重新发信时把上一枚标成已用：同时只有一枚有效，用户不会输错窗口。
    issueMemberCode({ email, instanceId, ttlMinutes = 10 }) {
      const address = String(email || "").trim().toLowerCase();
      const id = String(instanceId || "").trim();
      if (!address || !id) return { error: "invalid" };
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + ttlMinutes * 60_000);
      db.prepare("update member_codes set used_at = ? where email = ? and used_at is null").run(
        nowIso(),
        address
      );
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      db.prepare(
        `insert into member_codes (code_hash, email, instance_id, created_at, expires_at)
         values (?, ?, ?, ?, ?)`
      ).run(
        sha256(`${address}|${code}`),
        address,
        id,
        createdAt.toISOString(),
        expiresAt.toISOString()
      );
      return { code, expiresAt: expiresAt.toISOString() };
    },

    consumeMemberCode({ email, code, maxAttempts = 5 }) {
      const address = String(email || "").trim().toLowerCase();
      const value = String(code || "").replace(/\s+/g, "");
      if (!address || !/^[0-9]{6}$/.test(value)) return { error: "invalid" };
      const row = get(
        "select * from member_codes where email = ? and used_at is null order by created_at desc limit 1",
        address
      );
      if (!row) return { error: "not_found" };
      if (Date.parse(row.expires_at) <= Date.now()) return { error: "expired" };
      if (Number(row.attempts) >= maxAttempts) return { error: "too_many_attempts" };

      const hash = sha256(`${address}|${value}`);
      const match =
        hash.length === row.code_hash.length &&
        timingSafeEqual(Buffer.from(hash, "utf8"), Buffer.from(row.code_hash, "utf8"));
      if (!match) {
        db.prepare("update member_codes set attempts = attempts + 1 where code_hash = ?").run(row.code_hash);
        return { error: "mismatch" };
      }
      db.prepare("update member_codes set used_at = ? where code_hash = ?").run(nowIso(), row.code_hash);
      return { email: row.email, instanceId: row.instance_id };
    },

    createMemberSession({ email, instanceId, days = 30 }) {
      const token = randomBytes(32).toString("base64url");
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + days * 86400000);
      db.prepare(
        `insert into member_sessions (token_hash, email, instance_id, created_at, expires_at)
         values (?, ?, ?, ?, ?)`
      ).run(
        sha256(token),
        String(email || "").trim().toLowerCase(),
        String(instanceId || "").trim(),
        createdAt.toISOString(),
        expiresAt.toISOString()
      );
      return { token, expiresAt: expiresAt.toISOString() };
    },

    memberSession(token) {
      if (!token) return null;
      const row = get("select * from member_sessions where token_hash = ?", sha256(token));
      if (!row) return null;
      if (Date.parse(row.expires_at) <= Date.now()) {
        db.prepare("delete from member_sessions where token_hash = ?").run(row.token_hash);
        return null;
      }
      return { email: row.email, instanceId: row.instance_id, expiresAt: row.expires_at };
    },

    deleteMemberSession(token) {
      if (!token) return;
      db.prepare("delete from member_sessions where token_hash = ?").run(sha256(token));
    },

    pruneMemberSessions() {
      db.prepare("delete from member_sessions where expires_at <= ?").run(nowIso());
      db.prepare("delete from member_codes where expires_at <= ?").run(nowIso());
    },

    // 一个标签只要签发过或还在审核里就算占用；拒绝与撤回会释放它。
    takenSubdomains() {
      return all(
        `select subdomain from applications
          where subdomain is not null and subdomain <> ''
            and status not in ('rejected', 'withdrawn', 'expired')`
      ).map((row) => row.subdomain);
    },

    // 审核台自己的写操作也要留痕；内部 event() 只在库内使用。
    recordEvent(kind, ref, detail) {
      event(kind, ref, detail);
    },
    events(limit = 50) {
      return all("select * from events order by seq desc limit ?", Math.min(Number(limit) || 50, 200));
    },
  };
}

export function openMemoryStore() {
  return openStore(":memory:");
}
