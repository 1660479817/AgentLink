import path from "node:path";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import {
  agentEnvFileFor,
  createAgent,
  reviveAgent,
  rotateAgentToken,
  writeAgentEnvFile,
} from "../src/agentAccount.js";

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// 在主机上确保一个内部 Agent：没有就建，停用过就复起，在岗但授权码文件丢了就换一枚。
// 内部 Agent 属于主理人（accounts.role = 'owner'），最多 10 个。
// 返回 { id, displayName, envFile, created }；created 只表示「这次新建了一行」。
export async function ensureInternalAgent(pool, { name, envDir }) {
  const owner = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
  const ownerId = owner.rows[0]?.id;
  if (!ownerId) throw fail("owner_unconfigured");

  const found = await pool.query(
    `SELECT id, role, owner_id, display_name, retired_at FROM accounts
      WHERE lower(btrim(display_name)) = lower(btrim($1))`,
    [name]
  );
  const existing = found.rows[0];
  // 这个称呼属于别人（外部账号的 Agent，或某个人的账号）：不能借运维脚本改它的令牌。
  if (existing && (existing.role !== "agent" || existing.owner_id !== ownerId)) {
    throw fail("name_taken");
  }
  if (existing && !existing.retired_at) {
    const known = { id: existing.id, displayName: existing.display_name };
    const envFile = await agentEnvFileFor(envDir, known);
    if (await fileExists(envFile)) {
      return { id: existing.id, displayName: existing.display_name, envFile, created: false };
    }
    const rotated = await rotateAgentToken(pool, existing.id);
    const written = await writeAgentEnvFile(envDir, rotated);
    return { id: rotated.id, displayName: rotated.displayName, envFile: written, created: false };
  }
  const issued = existing
    ? await reviveAgent(pool, existing.id)
    : await createAgent(pool, { ownerId, name });
  const envFile = await writeAgentEnvFile(envDir, issued);
  return { id: issued.id, displayName: issued.displayName, envFile, created: issued.created };
}

// CLI 入口：ensure-internal-agent.sh 传一个称呼过来。
async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const name = String(process.argv[2] || "").replace(/\s+/g, " ").trim();
  if (!name) {
    console.error("用法：ensure-internal-agent.mjs <称呼>");
    process.exit(1);
  }

  const envDir = process.env.KNOT_AGENT_ENV_DIR || path.join(root, "sites", process.env.KNOT_SITE || "", "agents");
  const { databaseUrl } = loadBootstrapConfig();
  const pool = new pg.Pool({ connectionString: databaseUrl });

  let code = 0;
  try {
    const result = await ensureInternalAgent(pool, { name, envDir });
    if (result.created) {
      console.log(`${result.displayName} ${result.id}`);
      console.log(`授权码已写入 ${result.envFile}`);
    } else {
      console.log(`${result.displayName} ${result.id} 已有授权码 ${result.envFile}`);
    }
  } catch (error) {
    console.error(error.code || error.message);
    code = 1;
  } finally {
    await pool.end();
  }
  process.exit(code);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
