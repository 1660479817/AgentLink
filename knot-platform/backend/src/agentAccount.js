import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { displayNameText, specialtyList } from "./account.js";

// Agent 是账户名下的一个身份行（accounts.role = 'agent'），凭令牌接入。
// 令牌只在签发/重置的那一次返回明文，库里只存 sha256。

export function newAgentToken() {
  return randomBytes(24).toString("base64url");
}

export function hashAgentToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// 库里的名额错误码（见迁移里的触发器）翻成人能看的话。
export function mapAgentError(error) {
  if (error?.code === "KN002") return fail("agent_slots_full");
  if (error?.code === "KN003") return fail("bad_owner");
  if (error?.code === "KN001") return fail("users_full");
  if (error?.code === "23505" && error.constraint === "accounts_display_name_key") return fail("name_taken");
  return error;
}

// 签发失败时该回什么。只把界面翻得出来的码给出去，数据库原始错误码留在日志里。
export function agentIssueError(error) {
  const code = mapAgentError(error)?.code;
  if (code === "agent_slots_full" || code === "name_taken") return { status: 409, error: code };
  if (code === "users_full" || code === "bad_owner") return { status: 403, error: code };
  if (code === "bad_name" || code === "bad_specialty") return { status: 400, error: code };
  return { status: 503, error: "agent_unavailable" };
}

export async function agentByToken(pool, token) {
  const hash = hashAgentToken(token);
  const { rows } = await pool.query(
    `SELECT id, side, display_name, owner_id
       FROM accounts
      WHERE token_hash = $1 AND role = 'agent' AND retired_at IS NULL`,
    [hash]
  );
  return rows[0] || null;
}

export async function findAgentsOf(pool, ownerId, { includeRetired = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, display_name, retired_at, created_at, updated_at,
            (token_hash IS NOT NULL) AS has_token
       FROM accounts
      WHERE owner_id = $1 AND role = 'agent'
        ${includeRetired ? "" : "AND retired_at IS NULL"}
      ORDER BY created_at ASC`,
    [ownerId]
  );
  return rows;
}

export async function createAgent(pool, { ownerId, name, specialties = null }) {
  const displayName = displayNameText(name);
  const names = specialties ? specialtyList(specialties) : null;
  const token = newAgentToken();
  try {
    const { rows } = await pool.query(
      `INSERT INTO accounts (role, owner_id, display_name, token_hash, specialties)
       VALUES ('agent', $1, $2, $3, $4::jsonb)
       RETURNING id, display_name, created_at`,
      [ownerId, displayName, hashAgentToken(token), JSON.stringify(names || [])]
    );
    return {
      id: rows[0].id,
      displayName: rows[0].display_name,
      token,
      createdAt: rows[0].created_at,
      created: true,
    };
  } catch (error) {
    throw mapAgentError(error);
  }
}

export async function rotateAgentToken(pool, agentId) {
  const token = newAgentToken();
  const { rows } = await pool.query(
    `UPDATE accounts
        SET token_hash = $2, updated_at = now()
      WHERE id = $1 AND role = 'agent' AND retired_at IS NULL
      RETURNING id, display_name, created_at`,
    [agentId, hashAgentToken(token)]
  );
  if (!rows.length) throw fail("not_found");
  return { id: rows[0].id, displayName: rows[0].display_name, token, createdAt: rows[0].created_at, created: false };
}

// 复起：停用过的 Agent 保留原身份与历史内容，换一枚新令牌再上岗。
export async function reviveAgent(pool, agentId, specialties = null) {
  const token = newAgentToken();
  const { rows } = await pool.query(
    `UPDATE accounts
        SET retired_at = NULL, token_hash = $2, updated_at = now(),
            specialties = COALESCE($3::jsonb, specialties)
      WHERE id = $1 AND role = 'agent' AND retired_at IS NOT NULL
      RETURNING id, display_name, created_at`,
    [agentId, hashAgentToken(token), specialties ? JSON.stringify(specialties) : null]
  );
  if (!rows.length) throw fail("not_found");
  return { id: rows[0].id, displayName: rows[0].display_name, token, createdAt: rows[0].created_at, created: false };
}

// 停用：清掉令牌、留行。内容和作者身份都还在，名额空出来。
export async function retireAgent(pool, agentId) {
  const { rows } = await pool.query(
    `UPDATE accounts
        SET retired_at = now(), token_hash = NULL, updated_at = now()
      WHERE id = $1 AND role = 'agent' AND retired_at IS NULL
      RETURNING id, owner_id, display_name`,
    [agentId]
  );
  if (!rows.length) throw fail("not_found");
  return rows[0];
}

function personalAgentName(ownerName) {
  const suffix = " 的 Agent";
  const base = Array.from(String(ownerName || "").trim() || "用户");
  const room = Math.max(1, 40 - Array.from(suffix).length);
  return base.slice(0, room).join("") + suffix;
}

// 外部账号只有一个 Agent 名额：已有就换令牌，停用过就复起，都没有才新建。
// 调用方负责确认这是 user 账号（owner 的 Agent 从管理端签发）。
export async function ensurePersonalAgent(pool, owner) {
  const active = await findAgentsOf(pool, owner.id);
  if (active.length) return rotateAgentToken(pool, active[0].id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`knot:agents:${owner.id}`]);
    const live = await client.query(
      `SELECT id FROM accounts WHERE owner_id = $1 AND role = 'agent' AND retired_at IS NULL LIMIT 1`,
      [owner.id]
    );
    if (live.rows.length) {
      const result = await rotateAgentToken(client, live.rows[0].id);
      await client.query("COMMIT");
      return result;
    }
    const retired = await client.query(
      `SELECT id FROM accounts
        WHERE owner_id = $1 AND role = 'agent' AND retired_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
      [owner.id]
    );
    let result;
    if (retired.rows.length) {
      const token = newAgentToken();
      const { rows } = await client.query(
        `UPDATE accounts
            SET retired_at = NULL, token_hash = $2, updated_at = now()
          WHERE id = $1
          RETURNING id, display_name, created_at`,
        [retired.rows[0].id, hashAgentToken(token)]
      );
      result = { id: rows[0].id, displayName: rows[0].display_name, token, createdAt: rows[0].created_at, created: false };
    } else {
      result = await createAgent(client, { ownerId: owner.id, name: personalAgentName(owner.display_name) });
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw mapAgentError(error);
  } finally {
    client.release();
  }
}

export function agentEnvText(agent) {
  return [
    `KNOT_AGENT_NAME=${agent.displayName}`,
    `KNOT_AGENT_ID=${agent.id}`,
    `KNOT_AGENT_OWNER_ID=${agent.ownerId || ""}`,
    `KNOT_AGENT_TOKEN=${agent.token}`,
    "",
  ].join("\n");
}

// 称呼里可能有空格和标点，文件名只留安全的字符。
function agentStem(displayName) {
  return String(displayName).replace(/[^\p{L}\p{N}-]+/gu, "_").replace(/^_+|_+$/g, "") || "agent";
}

export function agentEnvPath(dir, displayName) {
  return path.join(dir, `${agentStem(displayName)}.local.env`);
}

// 文件里写着它属于哪个 Agent。认不出来（没这个文件、或没写 id）时返回 null。
async function envFileAgentId(file) {
  try {
    const text = await readFile(file, "utf8");
    const found = /^KNOT_AGENT_ID=(.*)$/m.exec(text);
    return found ? found[1].trim() : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// 称呼转成文件名时可能撞车（`豆包 / 搜索` 与 `豆包_搜索` 同一个 stem）。
// 默认位置被别的 Agent 占着就退到带 id 短号的名字，免得把别人的授权码覆盖掉。
export async function agentEnvFileFor(dir, agent) {
  const preferred = agentEnvPath(dir, agent.displayName);
  const holder = await envFileAgentId(preferred);
  if (holder === null || holder === agent.id) return preferred;
  const stem = agentStem(agent.displayName);
  const short = `${stem}.${String(agent.id).slice(0, 8)}.local.env`;
  const spare = path.join(dir, short);
  const spareHolder = await envFileAgentId(spare);
  if (spareHolder === null || spareHolder === agent.id) return spare;
  return path.join(dir, `${stem}.${agent.id}.local.env`);
}

export async function writeAgentEnvFile(dir, agent) {
  if (!agent?.displayName || !agent?.token) throw fail("bad_name");
  await mkdir(dir, { recursive: true });
  const file = await agentEnvFileFor(dir, agent);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, agentEnvText(agent), { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
  await chmod(file, 0o600);
  return file;
}

// 停用时把授权码文件带走：库里已经清空令牌，留着这份只会让人拿着死码去接。
export async function removeAgentEnvFile(dir, agent) {
  if (!dir || !agent?.displayName || !agent?.id) return false;
  const file = await agentEnvFileFor(dir, agent);
  try {
    await rm(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
