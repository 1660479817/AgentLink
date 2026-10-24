import { timingSafeEqual } from "node:crypto";
import {
  bioText,
  honorList,
  muteState,
  specialtyList,
  storedSpecialties,
  displayNameText,
  agentLimitOf,
  AGENT_LIMIT,
  USER_LIMIT,
} from "./account.js";
import { createAgent, findAgentsOf, hashAgentToken, mapAgentError, newAgentToken, readAgentToken, removeAgentEnvFile, retireAgent, reviveAgent, updateAgentEnvName, writeAgentEnvFile, writeAgentEnvToken } from "./agentAccount.js";
import { touchDiscoverBoard } from "./discoverPublish.js";
import { discardExtract } from "./extracts.js";
import { recordNotification } from "./notifications.js";
import { applyPoints, economyConfig } from "./points.js";
import { REVIEW_MAX_ATTEMPTS } from "./market.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITHIN = /^(\d+)(h|d|w)$/;
const REASON_MAX = 500;
const REPORT_MAX = 2000;
const LEVEL_MAX = 100;
const HONOR_MAX = 8;
const HONOR_NAME = 20;
const MUTE_FOREVER = new Date(Date.UTC(9999, 11, 31));
const ACCOUNT_COLUMNS = `id, role, side, email, display_name, owner_id, label, level, entitlements, points_balance, muted_until, specialties, bio, agent_type, retired_at`;
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

// 管理门的来源地址。实例前面常有一层本机反代（入口隧道把远端请求落到 127.0.0.1），
// 这时 remoteAddress 恒为回环，拿它判定必然放行（S12-07）。
// 只有对端确实是回环时才信代理写的 X-Forwarded-For（由 trust proxy 1 解成 req.ip）：
// 内网里直连端口的请求改不了自己的对端地址，伪造 XFF 也不会被当成回环。
export function adminDoorAddress(req) {
  const peer = req?.socket?.remoteAddress;
  if (isLoopbackAddress(peer)) return String(req?.ip || peer || "");
  return String(peer || "");
}

// 管理面只给「自己这台机器」和「同一内网」：回环，加 IPv4 私有地址
// （10/8、172.16/12、192.168/16）、链路本地（169.254/16），
// 以及 IPv6 的唯一本地地址（fc00::/7）与链路本地（fe80::/10）。
// 公网地址一律不放行；公网入口还有一层 nginx 直接 404。
export function isIntranetAddress(address) {
  const ip = String(address || "").trim().toLowerCase().replace(/^::ffff:/, "").replace(/%.*$/, "");
  if (isLoopbackAddress(ip)) return true;

  if (ip.includes(":")) {
    const head = Number.parseInt(ip.split(":")[0] || "", 16);
    if (!Number.isFinite(head)) return false;
    return (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80;
  }

  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (octets.some((octet) => !(octet >= 0 && octet <= 255))) return false;
  const [first, second] = octets;
  if (first === 10) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  return first === 169 && second === 254;
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
    role: row.role,
    side: row.side || null,
    ownerId: row.owner_id || null,
    email: row.email || null,
    displayName: row.display_name || "",
    bio: row.bio || "",
    label: row.label || "",
    level: row.level ?? 1,
    entitlements: honorList(row.entitlements),
    pointsBalance: row.points_balance ?? 0,
    muted: mute.muted,
    mutedUntil: mute.mutedUntil,
    specialties: storedSpecialties(row.specialties),
    // Agent 自述的产品类型（grok、manus、doubao……），人这一行恒为空。
    agentType: row.agent_type || "",
    retired: Boolean(row.retired_at),
    retiredAt: row.retired_at || null,
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
      `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`,
      [q]
    );
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS}
     FROM accounts
     WHERE lower(email) = lower($1) OR lower(btrim(display_name)) = lower(btrim($1))
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

// 管理端的总名册：平台账号、主理人、外部账号，以及每个账号名下的 Agent。
// 账号模型收成一张 accounts 之后，人、Agent、平台身份只是 role 不同，
// 所以列表一次全取回来，由页面按 side / role 分组，不再分两个接口拼。
const ROSTER_COLUMNS = `${ACCOUNT_COLUMNS}, created_at, (token_hash IS NOT NULL) AS has_token`;

function presentAgent(row, ownerName = "") {
  return {
    id: row.id,
    role: "agent",
    side: row.side || null,
    ownerId: row.owner_id || null,
    ownerName,
    displayName: row.display_name,
    bio: row.bio || "",
    createdAt: row.created_at,
    retiredAt: row.retired_at || null,
    hasToken: Boolean(row.has_token),
    specialties: storedSpecialties(row.specialties),
    // 画像用：这个 Agent 自称跑在哪个产品上。名单外的值原样留着。
    agentType: row.agent_type || "",
  };
}

export async function listAccountRoster(pool) {
  const { rows } = await pool.query(
    `SELECT ${ROSTER_COLUMNS}
       FROM accounts
      ORDER BY CASE role WHEN 'platform' THEN 0 WHEN 'owner' THEN 1 WHEN 'user' THEN 2 ELSE 3 END,
               created_at ASC`
  );

  const agentsByOwner = new Map();
  const nameById = new Map(rows.filter((row) => row.role !== "agent").map((row) => [row.id, row.display_name]));
  for (const row of rows) {
    if (row.role !== "agent" || !row.owner_id) continue;
    const list = agentsByOwner.get(row.owner_id) || [];
    list.push(presentAgent(row, nameById.get(row.owner_id) || ""));
    agentsByOwner.set(row.owner_id, list);
  }

  const people = rows.filter((row) => row.role !== "agent");
  const accounts = people.map((row) => {
    const agents = agentsByOwner.get(row.id) || [];
    return {
      ...presentAccount(row),
      createdAt: row.created_at,
      agentLimit: agentLimitOf({ role: row.role }),
      agentUsed: agents.filter((agent) => !agent.retiredAt).length,
      agents,
    };
  });

  const sumAgents = (account) => account.agents.filter((agent) => !agent.retiredAt).length;
  return {
    quota: {
      // 内部名额是主理人名下在岗的 Agent 数，与库里的触发器同一个口径。
      internalAgents: {
        used: accounts.filter((account) => account.role === "owner").reduce((sum, account) => sum + sumAgents(account), 0),
        limit: AGENT_LIMIT.owner,
      },
      // 外部账号数不算带 label 的测试员，与触发器里 label IS NULL 一致。
      externalAccounts: {
        used: people.filter((row) => row.role === "user" && !row.retired_at && !row.label).length,
        limit: USER_LIMIT,
      },
      externalAgents: {
        used: accounts.filter((account) => account.role === "user").reduce((sum, account) => sum + sumAgents(account), 0),
      },
    },
    accounts,
  };
}

// 管理端能改的身份资料：主理人，以及主理人名下的内部 Agent。
// 外部账号的资料归账号自己在「我的」里改，管理端只读：替一个人改称呼与简介，
// 等于用他的身份说话，而管理端要做的是审核与处置，不是代笔。
function editableIdentity(row) {
  if (!row) throw fail("not_found");
  if (row.role === "owner") return "account";
  if (row.role === "agent" && row.owner_role === "owner") return "agent";
  throw fail("not_editable");
}

export async function updateManagedAccount(pool, id, patch = {}, options = {}) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const { rows } = await pool.query(
    `SELECT a.${ACCOUNT_COLUMNS.split(", ").join(", a.")}, o.role AS owner_role
       FROM accounts a
       LEFT JOIN accounts o ON o.id = a.owner_id
      WHERE a.id = $1`,
    [id]
  );
  const row = rows[0];
  const kind = editableIdentity(row);
  const body = patch && typeof patch === "object" ? patch : {};

  const sets = ["updated_at = now()"];
  const params = [];
  const notes = [];
  let renamed = null;

  if (Object.hasOwn(body, "displayName")) {
    let name;
    try {
      name = displayNameText(body.displayName);
    } catch {
      throw fail("bad_name");
    }
    if (name === row.display_name) {
      // 原样提交不算错，也不写一行没有变化的流水。
    } else {
      params.push(name);
      sets.push(`display_name = $${params.length}`);
      notes.push(`称呼 ${row.display_name} → ${name}`);
      renamed = name;
    }
  }

  if (Object.hasOwn(body, "bio")) {
    let bio;
    try {
      bio = bioText(body.bio);
    } catch {
      throw fail("bad_bio");
    }
    if (bio !== (row.bio || "")) {
      params.push(bio);
      sets.push(`bio = $${params.length}`);
      notes.push(bio ? "简介已更新" : "简介已清空");
    }
  }

  if (Object.hasOwn(body, "specialties")) {
    if (kind !== "agent") throw fail("bad_args");
    let specialties;
    try {
      specialties = specialtyList(body.specialties);
    } catch {
      throw fail("bad_specialty");
    }
    const before = storedSpecialties(row.specialties);
    if (specialties.join("\u0000") !== before.join("\u0000")) {
      params.push(JSON.stringify(specialties));
      sets.push(`specialties = $${params.length}::jsonb`);
      notes.push(`特长 ${specialties.length ? specialties.join("、") : "已清空"}`);
    }
  }

  if (sets.length === 1) throw fail("empty_body");

  params.push(id);
  let updated;
  try {
    updated = await pool.query(
      `UPDATE accounts SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING ${ACCOUNT_COLUMNS}`,
      params
    );
  } catch (error) {
    if (error.code === "23505") throw fail("name_taken");
    throw error;
  }
  const saved = updated.rows[0];
  if (!saved) throw fail("not_found");

  // 内部 Agent 改了称呼：授权码文件里那一行名字跟着改，令牌与文件名都不动。
  // 文件改不成就把库里的称呼退回去，别让文件和账号对不上。
  let envFile = null;
  if (renamed && kind === "agent" && options.envDir) {
    try {
      envFile = await updateAgentEnvName(options.envDir, { id, displayName: renamed });
    } catch (error) {
      await pool
        .query(`UPDATE accounts SET display_name = $2, updated_at = now() WHERE id = $1`, [id, row.display_name])
        .catch((failure) => console.error(failure));
      throw fail("env_failed");
    }
  }

  const who = kind === "agent" ? `内部 Agent ${row.display_name}` : `主理人 ${row.display_name}`;
  // 流水沿用 config：admin_actions.action 是基线里定死的枚举，
  // 改主理人/内部 Agent 的资料属于站内配置变更，说明写在 body 里。
  await writeAction(pool, { action: "config", accountId: id, body: `改 ${who} 的资料：${notes.join("；")}。` });

  return { ok: true, kind, account: presentAccount(saved), envFile };
}

// 内部 Agent 只能挂在主理人名下，最多 10 个。名额由库里的触发器守，这里把错误翻成接口错误。
// 同名再签发是幂等的：在岗的直接返回它现在这一行（令牌不变）；停用过的用新令牌复起。
export async function issueInternalAgent(pool, name, options = {}) {
  const displayName = displayNameText(name);
  const specialties = Object.hasOwn(options, "specialties") ? specialtyList(options.specialties) : null;
  const envDir = String(options.envDir || "").trim();
  if (!envDir) throw fail("env_unconfigured");
  const writeEnv = options.writeEnv || writeAgentEnvFile;

  const owner = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
  const ownerId = owner.rows[0]?.id;
  if (!ownerId) throw fail("owner_unconfigured");

  const found = await pool.query(
    `SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE lower(btrim(display_name)) = lower(btrim($1))`,
    [displayName]
  );
  const existing = found.rows[0];
  if (existing && (existing.role !== "agent" || existing.owner_id !== ownerId)) throw fail("name_taken");
  if (existing && !existing.retired_at) {
    return { ok: true, created: false, issued: false, already: true, envFile: null, agent: presentIssued(existing) };
  }

  let issued;
  try {
    issued = existing
      ? await reviveAgent(pool, existing.id, specialties)
      : await createAgent(pool, { ownerId, name: displayName, specialties });
  } catch (error) {
    throw mapAgentError(error) || error;
  }
  issued.ownerId = ownerId;

  let envFile = null;
  try {
    envFile = await writeEnv(envDir, issued);
  } catch {
    // 授权码文件没写成，这次签发就当没发生。新建的删掉；复起的退回停用，令牌作废。
    if (existing) {
      await retireAgent(pool, existing.id).catch((error) => console.error(error));
    } else {
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [issued.id]).catch((error) => console.error(error));
    }
    throw fail("env_failed");
  }

  const note = specialties?.length
    ? `签发 ${issued.displayName}。特长 ${specialties.join("、")}`
    : `签发 ${issued.displayName}`;
  await pool.query(`INSERT INTO admin_actions (action, account_id, body) VALUES ('issue', $1, $2)`, [
    issued.id,
    note,
  ]);
  const { rows } = await pool.query(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1`, [issued.id]);
  if (!rows.length) throw fail("not_found");
  return { ok: true, created: !existing, issued: true, already: false, envFile, agent: presentIssued(rows[0]) };
}

// 管理端看到的 Agent 配额：内部 Agent 与每个外部账号的那一个。
export async function listAgents(pool) {
  const owner = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
  const ownerId = owner.rows[0]?.id || null;
  const agents = ownerId ? await findAgentsOf(pool, ownerId, { includeRetired: true }) : [];
  const users = await pool.query(
    `SELECT count(*)::int AS users FROM accounts WHERE role = 'user' AND retired_at IS NULL AND label IS NULL`
  );
  return {
    ownerId,
    internalLimit: AGENT_LIMIT.owner,
    internalUsed: agents.filter((agent) => !agent.retired_at).length,
    userLimit: USER_LIMIT,
    userUsed: Number(users.rows[0]?.users) || 0,
    agents: agents.map((agent) => ({
      id: agent.id,
      displayName: agent.display_name,
      createdAt: agent.created_at,
      hasToken: agent.has_token,
      retiredAt: agent.retired_at || null,
    })),
  };
}

// 停用任意一行的 Agent：内部（主理人名下）与外部（外部账号名下）都走这里。
// 外部账号在「我的」里也能自己停，管理端这一条是给泄漏的令牌与巡查兜底用的。
export async function retireManagedAgent(pool, id, reason, options = {}) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const text = requireText(reason, REASON_MAX, "bad_body");
  const { rows } = await pool.query(
    `SELECT a.id, a.display_name, o.role AS owner_role
       FROM accounts a JOIN accounts o ON o.id = a.owner_id
      WHERE a.id = $1 AND a.role = 'agent' AND a.retired_at IS NULL`,
    [id]
  );
  const agent = rows[0];
  if (!agent) throw fail("not_found");
  await retireAgent(pool, id);
  // 库里的令牌已经清空，磁盘上那份授权码也一起带走，别让人拿着死码去接。
  // 外部 Agent 没有授权码文件，这里只会得到 ENOENT。
  if (options.envDir) {
    await removeAgentEnvFile(options.envDir, { id, displayName: agent.display_name }).catch((error) =>
      console.error(error)
    );
  }
  const where = agent.owner_role === "owner" ? "内部" : "外部";
  await writeAction(pool, { action: "retire", accountId: id, body: `停用 ${where} Agent ${agent.display_name}。${text}` });
  return { ok: true, id, ownerRole: agent.owner_role };
}

// 管理端能看、能换的令牌只限主理人名下的内部 Agent：
// 明文写在 KNOT_AGENT_ENV_DIR 的授权码文件里，库里只有哈希。
// 外部 Agent 的码由账号自己在「我的」里拿，管理端转动它等于把人家踢下线，不做。
async function internalAgentRow(pool, id) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const { rows } = await pool.query(
    `SELECT a.id, a.display_name, a.owner_id, a.token_hash, o.role AS owner_role
       FROM accounts a JOIN accounts o ON o.id = a.owner_id
      WHERE a.id = $1 AND a.role = 'agent' AND a.retired_at IS NULL`,
    [id]
  );
  const agent = rows[0];
  if (!agent) throw fail("not_found");
  if (agent.owner_role !== "owner") throw fail("not_internal");
  return agent;
}

export async function readManagedAgentToken(pool, id, options = {}) {
  const agent = await internalAgentRow(pool, id);
  const envDir = String(options.envDir || "").trim();
  if (!envDir) throw fail("env_unconfigured");
  const found = await readAgentToken(envDir, { id: agent.id, displayName: agent.display_name });
  // 文件里的码要和库里的哈希对上：对不上说明这份文件过期了，给出去也接不上。
  if (!found || !agent.token_hash || hashAgentToken(found.token) !== agent.token_hash) {
    throw fail("token_unavailable");
  }
  return { ok: true, id: agent.id, token: found.token, file: found.file };
}

// 重新签发：旧码立刻失效，新码写回同一份授权码文件，免得文件和库各说各话。
// 先写文件再换库里的哈希：中途失败时旧码还能用，不会把 Agent 锁在门外。
export async function rotateManagedAgentToken(pool, id, options = {}) {
  const agent = await internalAgentRow(pool, id);
  const envDir = String(options.envDir || "").trim();
  if (!envDir) throw fail("env_unconfigured");
  const agentFile = { id: agent.id, displayName: agent.display_name, ownerId: agent.owner_id };
  const before = await readAgentToken(envDir, agentFile);
  const token = newAgentToken();

  let file;
  try {
    file = await writeAgentEnvToken(envDir, { ...agentFile, token });
  } catch {
    throw fail("env_failed");
  }

  const putBack = async () => {
    // 库里还是旧哈希：文件退回旧码；旧码本来就没有，就把刚写的那份删掉。
    if (before) {
      await writeAgentEnvToken(envDir, { ...agentFile, token: before.token }).catch((failure) =>
        console.error(failure)
      );
    } else {
      await removeAgentEnvFile(envDir, agentFile).catch((failure) => console.error(failure));
    }
  };

  // 换库里的哈希与写审计行放进同一个事务：审计写失败时，令牌也一起回滚，
  // 不会留下「库里已经换码、却查不到这次操作」的半完成状态（S13-04）。
  // 文件这一步先落盘，事务失败就把它退回旧码，Agent 不会被锁在门外。
  let rotated;
  try {
    rotated = await withClient(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE accounts SET token_hash = $2, updated_at = now()
          WHERE id = $1 AND role = 'agent' AND retired_at IS NULL
          RETURNING id`,
        [agent.id, hashAgentToken(token)]
      );
      if (!rows.length) return false;
      await client.query(`INSERT INTO admin_actions (action, account_id, body) VALUES ('issue', $1, $2)`, [
        agent.id,
        `重新签发 ${agent.display_name} 的授权码`,
      ]);
      return true;
    });
  } catch (error) {
    await putBack();
    throw fail("env_failed");
  }
  if (!rotated) {
    // 写文件这几毫秒里 Agent 被停用了：库里的令牌已经清空，文件也不该留着。
    await removeAgentEnvFile(envDir, agentFile).catch((failure) => console.error(failure));
    throw fail("not_found");
  }
  return { ok: true, id: agent.id, token, file };
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
     FROM accounts
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
             WHERE account_id = $1`;
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

export async function writeAction(pool, { action, accountId = null, intelId = null, body, actorId = null }) {
  await pool.query(
    `INSERT INTO admin_actions (action, account_id, intel_id, body, actor_account_id) VALUES ($1, $2, $3, $4, $5)`,
    [action, accountId, intelId, body, actorId]
  );
}

export async function removePost(pool, id, reason, { actorId = null, platformClosed = false } = {}) {
  if (!UUID.test(String(id || ""))) throw fail("not_found");
  const text = requireText(reason, REASON_MAX, "bad_body");
  // 撤下按整条修订链处理，不只处理被点的那一版。信息流、discover.json 与搜索
  // 用「同 origin 还有更新的可见版本」隐藏旧版；只把新版置为 removed 时，旧版
  // 会立刻重新可见（S11-01）。作者删除 deleteOwnPost 已是这个口径，这里对齐。
  // 被点的可能是链上任意一版，用子查询取它所属的 COALESCE(origin_id, id)。
  // 撤下、通知、审计三件事在一个事务里：只提交前一半会留下「帖没了、作者不知道、
  // 流水也没有」的半完成状态，而接口只会回一个 500，管理员以为没删成（S11-06）。
  const outcome = await withClient(pool, async (client) => {
    const { rows } = await client.query(
      `UPDATE intel
       SET verdict = 'removed', reject_reason = $2, is_public = false
       WHERE verdict <> 'removed'
         AND COALESCE(origin_id, id) = (SELECT COALESCE(origin_id, id) FROM intel WHERE id = $1)
       RETURNING id, account_id`,
      [id, text]
    );
    if (!rows.length) {
      const existing = await client.query(`SELECT id FROM intel WHERE id = $1 AND verdict = 'removed'`, [id]);
      if (!existing.rows.length) throw fail("not_found");
      return { rows: [], already: true };
    }
    await recordNotification(client, {
      userId: rows[0].account_id,
      kind: "intel_removed",
      title: "帖子已删除",
      body: text,
      href: "/mine/submissions",
      data: platformClosed ? { platformClosed: true } : { reason: text },
    });
    await writeAction(client, { action: "remove", accountId: rows[0].account_id, intelId: id, body: text, actorId });
    return { rows, already: false };
  });
  if (outcome.already) return { ok: true, already: true, id };
  // 链上每一版都有自己的摘要文件，一起清掉，免得撤下后还占着磁盘。
  // 删盘不进事务：它不可回滚，放进事务里反而会留下「库回滚了、文件已经没了」。
  for (const row of outcome.rows) await discardExtract(row.id);
  touchDiscoverBoard();
  return { ok: true, already: false, id, userId: outcome.rows[0].account_id };
}

export function grantAmount(value) {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^[1-9]\d*$/.test(text)) throw fail("bad_amount");
  const amount = Number(text);
  if (!Number.isSafeInteger(amount) || amount > economyConfig().grantMax) throw fail("bad_amount");
  return amount;
}

export async function grantPoints(pool, user, amount, body, requestId = "") {
  const points = grantAmount(amount);
  const text = requireText(body, REASON_MAX, "bad_body");
  // 幂等键由客户端给：一次填表一个，重试复用、重新填表换新的（见 admin/admin.js）。
  // 只接受无歧义的短串，别让任意文本进唯一索引。先验键，再查人：格式错就是一次无用查询。
  const request = String(requestId || "").trim();
  if (request && !/^[A-Za-z0-9_-]{8,64}$/.test(request)) throw fail("bad_request_id");
  const account = await oneUser(pool, user);
  assertPersonAccount(account);
  const note = `到账 ${points}。${text}`;
  const client = await pool.connect();
  const duplicate = async () => {
    const current = await client.query(`SELECT points_balance FROM accounts WHERE id = $1`, [account.id]);
    const pointsBalance = Number(current.rows[0]?.points_balance) || 0;
    return {
      ok: true,
      duplicate: true,
      amount: points,
      user: { ...presentAccount(account), pointsBalance },
      pointsBalance,
    };
  };
  try {
    await client.query("BEGIN");
    // 同一账户的发放串行化：同一账户上的两笔并发发放要按到达顺序落账。
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`knot:grant:${account.id}`]);
    if (request) {
      // 带键的：只认这个键。重试（超时后再点一次）拿到的是同一笔，不会被记成两笔。
      const replay = await client.query(
        `SELECT id FROM admin_actions WHERE action = 'grant' AND request_id = $1 LIMIT 1`,
        [request]
      );
      if (replay.rows.length) {
        const result = await duplicate();
        await client.query("COMMIT");
        return result;
      }
    } else {
      // 没带键的老调用（curl、旧版后台页）：退回按「收件人 + 金额 + 理由」在短窗口内去重。
      // 这是猜的——十分钟内真要发两笔一样的，第二笔会被吞；新版后台一律带键。
      const replay = await client.query(
        `SELECT id FROM admin_actions
          WHERE action = 'grant' AND account_id = $1 AND body = $2
            AND created_at > now() - interval '10 minutes'
          ORDER BY created_at DESC LIMIT 1`,
        [account.id, note]
      );
      if (replay.rows.length) {
        const result = await duplicate();
        await client.query("COMMIT");
        return result;
      }
    }
    const action = await client.query(
      `INSERT INTO admin_actions (action, account_id, body, request_id) VALUES ('grant', $1, $2, $3) RETURNING id`,
      [account.id, note, request || null]
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
      data: { amount: points, note: text },
    });
    await client.query("COMMIT");
    return { ok: true, user: { ...presentAccount(account), pointsBalance: balance }, amount: points, pointsBalance: balance };
  } catch (error) {
    await client.query("ROLLBACK");
    // 两个并发的同一笔：账号不同时互不加锁，靠唯一索引兜住后来那一个。
    if (error.code === "23505" && error.constraint === "admin_actions_request_id_idx") {
      return duplicate();
    }
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

function assertNotPlatform(account) {
  if (account.role === "platform") throw fail("protected");
}

// 等级与权益是人的东西。Agent 不带等级、不带权益，也不收积分。
function assertPersonAccount(account) {
  assertNotPlatform(account);
  if (account.role === "agent") throw fail("not_account");
}

async function lockAccount(client, id) {
  const { rows } = await client.query(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = $1 FOR UPDATE`, [id]);
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
  assertNotPlatform(account);
  const note = muteNote(deadline, text);
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertNotPlatform(locked);
    const { rows } = await client.query(
      `UPDATE accounts SET muted_until = $2, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id, deadline]
    );
    await client.query(
      `INSERT INTO admin_actions (action, account_id, body) VALUES ('mute', $1, $2)`,
      [locked.id, note]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "muted",
      title: "已被禁言",
      body: note,
      href: "/mine",
      data: { until: muteState(deadline).mutedUntil, note: text },
    });
    return { ok: true, already: false, user: presentAccount(rows[0]) };
  });
}

export async function unmuteUser(pool, user, body) {
  const text = requireText(body, REASON_MAX, "bad_body");
  const account = await oneUser(pool, user);
  assertNotPlatform(account);
  if (!muteState(account.muted_until).muted) return { ok: true, already: true, user: presentAccount(account) };
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertNotPlatform(locked);
    if (!muteState(locked.muted_until).muted) return { ok: true, already: true, user: presentAccount(locked) };
    const { rows } = await client.query(
      `UPDATE accounts SET muted_until = NULL, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id]
    );
    await client.query(
      `INSERT INTO admin_actions (action, account_id, body) VALUES ('unmute', $1, $2)`,
      [locked.id, text]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "unmuted",
      title: "禁言已解除",
      body: text,
      href: "/mine",
      data: { note: text },
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
  assertPersonAccount(account);
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertPersonAccount(locked);
    const current = honorList(locked.entitlements);
    const granted = adding.filter((name) => !current.includes(name));
    const revoked = removing.filter((name) => current.includes(name));
    if (!granted.length && !revoked.length) return { ok: true, already: true, granted, revoked, user: presentAccount(locked) };
    const next = [...current.filter((name) => !revoked.includes(name)), ...granted];
    if (next.length > HONOR_MAX) throw fail("entitlement_full");
    const { rows } = await client.query(
      `UPDATE accounts
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
      `INSERT INTO admin_actions (action, account_id, body) VALUES ('entitle', $1, $2)`,
      [locked.id, note]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "entitled",
      title: "权益已更新",
      body: note,
      href: "/mine",
      data: { granted, revoked, note: text },
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
  assertPersonAccount(account);
  if (account.level === next) return { ok: true, already: true, user: presentAccount(account) };
  const note = `现在是 ${next}。${text}`;
  return withClient(pool, async (client) => {
    const locked = await lockAccount(client, account.id);
    assertPersonAccount(locked);
    if (locked.level === next) return { ok: true, already: true, user: presentAccount(locked) };
    const { rows } = await client.query(
      `UPDATE accounts SET level = $2, updated_at = now() WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [locked.id, next]
    );
    await client.query(
      `INSERT INTO admin_actions (action, account_id, body) VALUES ('level', $1, $2)`,
      [locked.id, note]
    );
    await recordNotification(client, {
      userId: locked.id,
      kind: "level_changed",
      title: "等级已更新",
      body: note,
      href: "/mine",
      data: { level: next, note: text },
    });
    return { ok: true, already: false, user: presentAccount(rows[0]) };
  });
}

export async function warnUser(pool, user, body) {
  const account = await oneUser(pool, user);
  const text = requireText(body, REASON_MAX, "bad_body");
  // 警告与流水同一事务：只写进通知、流水失败时，用户已经收到警告，
  // 而管理端既看不到这次操作也重试不了（S11-13）。
  await withClient(pool, async (client) => {
    await recordNotification(client, {
      userId: account.id,
      kind: "warning",
      title: "平台警告",
      body: text,
      data: { note: text },
    });
    await writeAction(client, { action: "warn", accountId: account.id, body: text });
  });
  return { ok: true, user: presentAccount(account) };
}

// 巡查队列的下界是「上一轮报告实际覆盖到的那条帖」，不是「上一份报告写下的时刻」。
// 用提交时刻做水位有两个漏洞：巡查期间新发的帖、以及积压超过 LIMIT 的那一批，
// 创建时间都早于新水位，从此再也不会出现在队列里（S11-05）。
// 覆盖到哪条记在 admin_actions.intel_id 上：一条 patrol 流水指向本轮看的最后一条。
export async function patrolQueue(pool) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.created_at, u.id AS account_id, u.email, u.display_name
     FROM intel i
     JOIN accounts u ON u.id = i.account_id
     WHERE i.verdict = 'passed'
       AND i.is_public
       AND i.created_at > COALESCE(
         (SELECT covered.created_at
            FROM admin_actions a
            JOIN intel covered ON covered.id = a.intel_id
           WHERE a.action = 'patrol' AND a.intel_id IS NOT NULL
           ORDER BY a.created_at DESC
           LIMIT 1),
         now() - interval '1 day'
       )
     ORDER BY i.created_at ASC
     LIMIT 40`
  );
  const posts = rows.map((row) => ({
    id: row.id,
    body: clipText(row.body, 400),
    createdAt: row.created_at,
    user: {
      id: row.account_id,
      email: row.email,
      displayName: row.display_name || "",
    },
  }));
  // through 交给页面原样回传：报告提交时用它推进水位。
  return { posts, through: posts.length ? posts[posts.length - 1].id : null };
}

// 终审失败的记录：评审员超时、报错或交回坏结果时，这条记录停在 pending 并带上
// detail.reviewError / reviewAttempts。作者不再收到通知，管理端在这里统一看。
export async function listReviewFailures(pool) {
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.detail, i.created_at, u.id AS account_id, u.email, u.display_name
       FROM intel i
       JOIN accounts u ON u.id = i.account_id
      WHERE i.verdict = 'pending'
        AND (i.detail->>'reviewError' IS NOT NULL OR COALESCE((i.detail->>'reviewAttempts')::int, 0) > 0)
      ORDER BY i.created_at DESC
      LIMIT 200`
  );
  return rows.map((row) => {
    const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
    const attempts = Number(detail.reviewAttempts) || 0;
    return {
      id: row.id,
      body: clipText(row.body, 400),
      createdAt: row.created_at,
      error: typeof detail.reviewError === "string" ? detail.reviewError : "",
      attempts,
      gaveUp: attempts >= REVIEW_MAX_ATTEMPTS,
      user: {
        id: row.account_id,
        email: row.email,
        displayName: row.display_name || "",
      },
    };
  });
}

export async function recordPatrol(pool, body, through = null) {
  const text = requireText(body, REPORT_MAX, "bad_body");
  let anchor = null;
  if (through != null && String(through).trim()) {
    anchor = String(through).trim();
    if (!UUID.test(anchor)) throw fail("bad_args");
    // 水位要靠这条帖子的 created_at，帖不在就退回「不推进」，别写一条指空的流水。
    const { rows } = await pool.query(`SELECT id FROM intel WHERE id = $1`, [anchor]);
    if (!rows.length) throw fail("not_found");
  }
  await writeAction(pool, { action: "patrol", intelId: anchor, body: text });
  return { ok: true, through: anchor };
}
