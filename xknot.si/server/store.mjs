// 申请与管理员账号的存储。
//
// 用 Node 自带的 node:sqlite，不留外部依赖；库文件放在 var/，不入版本库。
// 这一层只做读写，不判断业务，也不碰 HTTP。

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
create table if not exists applications (
  id           text primary key,
  name         text not null,
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
  ip_hash      text
);

create index if not exists applications_status on applications(status, created_at);
create index if not exists applications_url on applications(url);

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
`;

export const STATUSES = ["pending", "approved", "rejected", "hold"];

function nowIso() {
  return new Date().toISOString();
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
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      operator: row.operator,
      email: row.email,
      region: row.region,
      timezone: row.timezone,
      intro: row.intro,
      tags: (() => {
        try {
          const parsed = JSON.parse(row.tags);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      })(),
      locale: row.locale || null,
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
      reviewNote: row.review_note,
    };
  }

  return {
    file,
    db,
    close() {
      db.close();
    },

    // ---- 申请 ----

    // 同一个站点地址只允许一条未结案的申请，避免重复提交刷进审核队列。
    findOpenByUrl(url) {
      return rowToApplication(
        get(
          "select * from applications where url = ? and status in ('pending', 'hold', 'approved') order by created_at desc limit 1",
          url
        )
      );
    },

    createApplication(input) {
      const createdAt = nowIso();
      const id = newApplicationId(new Date(createdAt));
      db.prepare(
        `insert into applications
          (id, name, url, operator, email, region, timezone, intro, tags, locale, status, created_at, ip_hash)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(
        id,
        input.name,
        input.url,
        input.operator,
        input.email,
        input.region,
        input.timezone,
        input.intro,
        JSON.stringify(input.tags || []),
        input.locale || null,
        createdAt,
        input.ipHash || null
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
      const out = { pending: 0, approved: 0, rejected: 0, hold: 0 };
      for (const row of all("select status, count(*) as n from applications group by status")) {
        out[row.status] = row.n;
      }
      return out;
    },

    // 审核只允许 pending/hold 走进 approved/rejected；已结案的再改会留下痕迹。
    reviewApplication({ id, decision, note = "", admin }) {
      const current = this.getApplication(id);
      if (!current) return { error: "not_found" };
      if (decision !== "approved" && decision !== "rejected" && decision !== "hold") {
        return { error: "invalid_decision" };
      }
      const reviewedAt = nowIso();
      db.prepare(
        "update applications set status = ?, reviewed_at = ?, reviewed_by = ?, review_note = ? where id = ?"
      ).run(decision, reviewedAt, admin, String(note || "").slice(0, 500), current.id);
      event(`application.${decision}`, current.id, admin);
      return { application: this.getApplication(current.id) };
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

    events(limit = 50) {
      return all("select * from events order by seq desc limit ?", Math.min(Number(limit) || 50, 200));
    },
  };
}

export function openMemoryStore() {
  return openStore(":memory:");
}
