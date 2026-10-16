import { timingSafeEqual } from "node:crypto";
import { honorList, muteState, specialtyList, storedSpecialties } from "./account.js";
import { ensureInternalAgent, internalAgentName, writeAgentEnvFile } from "./internalAgent.js";
import { touchDiscoverBoard } from "./discoverPublish.js";
import { discardExtract } from "./extracts.js";
import { recordNotification } from "./notifications.js";
import { applyPoints, economyConfig } from "./points.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITHIN = /^(\d+)(h|d|w)$/;
const REASON_MAX = 500;
const REPORT_MAX = 2000;
const LEVEL_MAX = 100;
const HONOR_MAX = 8;
const HONOR_NAME = 20;
const MUTE_FOREVER = new Date(Date.UTC(9999, 11, 31));
const ACCOUNT_COLUMNS = `id, email, display_name, label, side, level, entitlements, points_balance, muted_until`;
const RECENT_LIMIT = 30;
const WINDOW_LIMIT = 200;
const WITHIN_MAX_HOURS = 24 * 366;

function fail(code, extra) {
  const error = new Error(code);
  error.code = code;
  if (extra) Object.assign(error, extra);
  return error;
}

export function isLoopbackAddress(address) {
  const ip = String(address || "").replace(/^::ffff:/, "");
  return ip === "127.0.0.1" || ip === "::1";
}

export function bearerToken(header) {
  const match = String(header || "").match(/^Bearer\s+(\S+)\s*$/i);
  return match ? match[1] : "";
}

export function tokensMatch(expected, presented) {
  const left = Buffer.from(String(expected || ""));
  const right = Buffer.from(String(presented || ""));
  if (!left.length || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function clipText(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function requireText(value, max, code) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) throw fail(code);
  return text;
}

function likeNeedle(value) {
  return `%${String(value).replace(/[%_\\]/g, "")}%`;
}

function presentAccount(row) {
  const mute = muteState(row.muted_until);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name || "",
    label: row.label || "",
    side: row.side || "external",
    level: row.level ?? 1,
    entitlements: honorList(row.entitlements),
    pointsBalance: row.points_balance ?? 0,
    muted: mute.muted,
    mutedUntil: mute.mutedUntil,
  };
}

function presentPost(row) {
  return {
    id: row.id,
    body: clipText(row.body, 400),
    verdict: row.verdict,
    public: row.is_public !== false,
    createdAt: row.created_at,
  };
}

export async function findUsers(pool, query) {
  const q = clipText(query, 200);
  if (!q) throw fail("bad_user");
  if (UUID.test(q)) {
    const { rows } = await pool.query(
      `SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = $1`,
      [q]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM users
     WHERE lower(email) = lower($1) OR display_name = $1
     ORDER BY created_at ASC
     LIMIT 6`,
    [q]
  );
  return rows;
}

async function oneUser(pool, query) {
  const rows = await findUsers(pool, query);
  if (!rows.length) throw fail("not_found");
  if (rows.length > 1) throw fail("ambiguous", { users: rows.map(presentAccount) });
  return rows[0];
}

function presentIssued(row) {
  return { ...presentAccount(row), specialties: storedSpecialties(row.specialties) };
}

export async function issueInternalAgent(pool, name, options = {}) {
  if (!internalAgentName(name)) throw fail("bad_name");
  const specialties = Object.hasOwn(options, "specialties") ? specialtyList(options.specialties) : null;
  const envDir = String(options.envDir || "").trim();
  if (!envDir) throw fail("env_unconfigured");
  const writeEnv = options.writeEnv || writeAgentEnvFile;
  const issued = await ensureInternalAgent(pool, name);
  if (issued.created && specialties) {
    await pool.query(
      `UPDATE users SET specialties = $2::jsonb, updated_at = now() WHERE id = $1`,
      [issued.userId, JSON.stringify(specialties)]
    );
  }
  let envFile = null;
  if (issued.token) {
    try {
      envFile = await writeEnv(envDir, issued);
    } catch {
      try {
        await pool.query(`DELETE FROM delegations WHERE user_id = $1`, [issued.userId]);
        if (issued.created) await pool.query(`DELETE FROM users WHERE id = $1`, [issued.userId]);
      } catch (rollbackError) {
        console.error(rollbackError);
      }
      throw fail("env_failed");
    }
    const note = specialties?.length ? `签发 ${issued.displayName}。特长 ${specialties.join("、")}` : `签发 ${issued.displayName}`;
    await pool.query(
      `INSERT INTO admin_actions (action, user_id, body) VALUES ('issue', $1, $2)`,
      [issued.userId, note]
    );
  }
  const { rows } = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}, specialties FROM users WHERE id = $1`,
    [issued.userId]
  );
  if (!rows.length) throw fail("not_found");
  return {
    ok: true,
    created: issued.created,
    issued: Boolean(issued.token),
    already: !issued.token,
    envFile,
    user: presentIssued(rows[0]),
  };
}

export async function searchUsers(pool, query) {
  const q = clipText(query, 200);
  if (!q) throw fail("bad_user");
  if (UUID.test(q)) {
    const rows = await findUsers(pool, q);
    return rows.map(presentAccount);
  }
  const { rows } = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM users
     WHERE email ILIKE $1 OR display_name ILIKE $1 OR label = $2
     ORDER BY created_at DESC
     LIMIT 20`,
    [likeNeedle(q), q]
  );
  return rows.map(presentAccount);
}

export function hoursWithin(value) {
  if (value == null || String(value).trim() === "") return null;
  const match = String(value).trim().toLowerCase().match(WITHIN);
  if (!match) throw fail("bad_within");
  const count = Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) throw fail("bad_within");
  const hours = match[2] === "h" ? count : match[2] === "d" ? count * 24 : count * 168;
  if (hours > WITHIN_MAX_HOURS) throw fail("bad_within");
  return { hours, within: `${count}${match[2]}` };
}

export async function listPosts(pool, { user, q, within }) {
  const account = await oneUser(pool, user);
  const window = hoursWithin(within);
  const needle = clipText(q, 200);
  const params = [account.id];
  let sql = `SELECT id, body, verdict, is_public, created_at, count(*) OVER () AS total
             FROM intel
             WHERE user_id = $1`;
  if (window) {
    params.push(window.hours);
    sql += ` AND created_at >= now() - make_interval(hours => $${params.length}::int)`;
  }
  if (needle) {
    params.push(likeNeedle(needle));
    sql += ` AND body ILIKE $${params.length}`;
  }
  params.push(window ? WINDOW_LIMIT : RECENT_LIMIT);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return {
    user: presentAccount(account),
    within: window ? window.within : null,
    total: rows.length ? Number(rows[0].total) : 0,
    posts: rows.map(presentPost),
  };
}

async function writeAction(pool, { action, userId = null, intelId = null, body }) {
  await pool.query(
    `INSERT INTO admin_actions (action, user_id, intel_id, body) VALUES ($1, $2, $3, $4)`,
    [action, userId, intelId, body]
  );
}

export async function removePost(pool, id, reason) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const text = requireText(reason, REASON_MAX, "bad_body");
  const { rows } = await pool.query(
    `UPDATE intel
     SET verdict = 'removed', reject_reason = $2, is_public = false
     WHERE id = $1 AND verdict <> 'removed'
     RETURNING id, user_id`,
    [id, text]
  );
  if (!rows.length) {
    const existing = await pool.query(`SELECT id FROM intel WHERE id = $1 AND verdict = 'removed'`, [id]);
    if (!existing.rows.length) throw fail("not_found");
    return { ok: true, already: true, id };
  }
  await discardExtract(id);
  await recordNotification(pool, {
    userId: rows[0].user_id,
    kind: "intel_removed",
    title: "帖子已删除",
    body: text,
    href: "/mine/submissions",
  });
  await writeAction(pool, { action: "remove", userId: rows[0].user_id, intelId: id, body: text });
  touchDiscoverBoard();
  return { ok: true, already: false, id, userId: rows[0].user_id };
}

export function grantAmount(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d*$/.test(text)) throw fail("bad_amount");
  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount > economyConfig().grantMax) throw fail("bad_amount");
  return amount;
}

export async function grantPoints(pool, user, amount, body) {
  const points = grantAmount(amount);
  const text = requireText(body, REASON_MAX, "bad_body");
  const account = await oneUser(pool, user);
  const note = `到账 ${points}。${text}`;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const action = await client.query(
      `INSERT INTO admin_actions (action, user_id, body) VALUES ('grant', $1, $2) RETURNING id`,
      [account.id, note]
    );
    const balance = await applyPoints(client, {
      userId: account.id,
      delta: points,
      reason: "grant",
      refId: action.rows[0].id,
    });
    await recordNotification(client, {
      userId: account.id,
      kind: "points_granted",
      title: "积分已到账",
      body: note,
      href: "/mine",
    });
    await client.query("COMMIT");
    return { ok: true, user: { ...presentAccount(account), pointsBalance: balance }, amount: points, pointsBalance: balance };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function shanghaiStamp(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

async function withClient(pool, run) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function assertPerson(account) {
  if (account.label === "platform") throw fail("protected");
}

async function lockAccount(client, id) {
  const { rows } = await client.query(`SELECT ${ACCOUNT_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows.length) throw fail("not_found");
  return rows[0];
}

export function muteDeadline(value, now = new Date()) {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "forever") return MUTE_FOREVER;
  let window;
  try {
    window = hoursWithin(text);
  } catch (error) {
    if (error.code === "bad_within") throw fail("bad_until");
    throw error;
  }
  if (!window) throw fail("bad_until");
  return new Date(now.getTime() + window.hours * 60 * 60 * 1000);
}

function muteNote(until, reason) {
  if (muteState(until).mutedUntil == null) return `禁言，直到平台解除。${reason}`;
  return `禁言至 ${shanghaiStamp(until)}。${reason}`;
}

export async function muteUser(pool, user, until, body) {
  const deadline = muteDeadline(until);
  const text = requireText(body, REASON_MAX, "bad_body");
  const account = await oneUser(pool, user);
  assertPerson(account);
  const note = muteNote(deadline, text);
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertPerson(locked);
    const { rows } = await client.query(
      `UPDATE users SET muted_until = $2, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id, deadline]
    );
    await client.query(
      `INSERT INTO admin_actions (action, user_id, body) VALUES ('mute', $1, $2)`,
      [locked.id, note]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "muted",
      title: "已被禁言",
      body: note,
      href: "/mine",
    });
    return { ok: true, already: false, user: presentAccount(rows[0]) };
  });
}

export async function unmuteUser(pool, user, body) {
  const text = requireText(body, REASON_MAX, "bad_body");
  const account = await oneUser(pool, user);
  assertPerson(account);
  if (!muteState(account.muted_until).muted) return { ok: true, already: true, user: presentAccount(account) };
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertPerson(locked);
    if (!muteState(locked.muted_until).muted) return { ok: true, already: true, user: presentAccount(locked) };
    const { rows } = await client.query(
      `UPDATE users SET muted_until = NULL, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id]
    );
    await client.query(
      `INSERT INTO admin_actions (action, user_id, body) VALUES ('unmute', $1, $2)`,
      [locked.id, text]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "unmuted",
      title: "禁言已解除",
      body: text,
      href: "/mine",
    });
    return { ok: true, already: false, user: presentAccount(rows[0]) };
  });
}

export function entitlementName(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text || text.length > HONOR_NAME || /[、,，]/.test(text)) throw fail("bad_entitlement");
  return text;
}

function uniqueNames(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw fail("bad_entitlement");
  const names = [];
  for (const item of value) {
    const name = entitlementName(item);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export async function setEntitlements(pool, user, grant, revoke, body) {
  const text = requireText(body, REASON_MAX, "bad_body");
  const adding = uniqueNames(grant);
  const removing = uniqueNames(revoke);
  if (!adding.length && !removing.length) throw fail("bad_entitlement");
  if (adding.some((name) => removing.includes(name))) throw fail("bad_entitlement");
  const account = await oneUser(pool, user);
  assertPerson(account);
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertPerson(locked);
    const current = honorList(locked.entitlements);
    const granted = adding.filter((name) => !current.includes(name));
    const revoked = removing.filter((name) => current.includes(name));
    if (!granted.length && !revoked.length) return { ok: true, already: true, granted, revoked, user: presentAccount(locked) };
    const next = [...current.filter((name) => !revoked.includes(name)), ...granted];
    if (next.length > HONOR_MAX) throw fail("entitlement_full");
    const { rows } = await client.query(
      `UPDATE users
       SET entitlements = jsonb_set(COALESCE(entitlements, '{}'::jsonb), '{honors}', $2::jsonb, true),
           updated_at = now()
       WHERE id = $1
       RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id, JSON.stringify(next)]
    );
    const parts = [];
    if (granted.length) parts.push(`获得 ${granted.join("、")}`);
    if (revoked.length) parts.push(`收回 ${revoked.join("、")}`);
    const note = `${parts.join("。")}。${text}`;
    await client.query(
      `INSERT INTO admin_actions (action, user_id, body) VALUES ('entitle', $1, $2)`,
      [locked.id, note]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "entitled",
      title: "权益已更新",
      body: note,
      href: "/mine",
    });
    return { ok: true, already: false, granted, revoked, user: presentAccount(rows[0]) };
  });
}

export function accountLevel(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d*$/.test(text)) throw fail("bad_level");
  const level = Number(text);
  if (!Number.isSafeInteger(level) || level > LEVEL_MAX) throw fail("bad_level");
  return level;
}

export async function setLevel(pool, user, level, body) {
  const next = accountLevel(level);
  const text = requireText(body, REASON_MAX, "bad_body");
  const account = await oneUser(pool, user);
  assertPerson(account);
  if (account.level === next) return { ok: true, already: true, user: presentAccount(account) };
  const note = `现在是 ${next}。${text}`;
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertPerson(locked);
    if (locked.level === next) return { ok: true, already: true, user: presentAccount(locked) };
    const { rows } = await client.query(
      `UPDATE users SET level = $2, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id, next]
    );
    await client.query(
      `INSERT INTO admin_actions (action, user_id, body) VALUES ('level', $1, $2)`,
      [locked.id, note]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "level_changed",
      title: "等级已更新",
      body: note,
      href: "/mine",
    });
    return { ok: true, already: false, user: presentAccount(rows[0]) };
  });
}

export async function warnUser(pool, user, body) {
  const account = await oneUser(pool, user);
  const text = requireText(body, REASON_MAX, "bad_body");
  await recordNotification(pool, {
    userId: account.id,
    kind: "warning",
    title: "平台警告",
    body: text,
  });
  await writeAction(pool, { action: "warn", userId: account.id, body: text });
  return { ok: true, user: presentAccount(account) };
}

export async function patrolQueue(pool) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.created_at, u.id AS user_id, u.email, u.display_name
     FROM intel i
     JOIN users u ON u.id = i.user_id
     WHERE i.verdict = 'passed'
       AND i.is_public
       AND i.created_at > COALESCE(
         (SELECT max(created_at) FROM admin_actions WHERE action = 'patrol'),
         now() - interval '1 day'
       )
     ORDER BY i.created_at ASC
     LIMIT 40`
  );
  return {
    posts: rows.map((row) => ({
      id: row.id,
      body: clipText(row.body, 400),
      createdAt: row.created_at,
      user: {
        id: row.user_id,
        email: row.email,
        displayName: row.display_name || "",
      },
    })),
  };
}

export async function recordPatrol(pool, body) {
  const text = requireText(body, REPORT_MAX, "bad_body");
  await writeAction(pool, { action: "patrol", body: text });
  return { ok: true };
}
