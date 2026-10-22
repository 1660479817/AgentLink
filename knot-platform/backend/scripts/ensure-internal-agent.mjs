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

// 在主机上确保一个内部 Agent：没有就建，停用过就复起，在岗但授权码文件丢了就换一枚。
// 内部 Agent 属于主理人（accounts.role = 'owner'），最多 10 个。
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const name = String(process.argv[2] || "").replace(/\s+/g, " ").trim();
if (!name) {
  console.error("用法：ensure-internal-agent.mjs <称呼>");
  process.exit(1);
}

const envDir = process.env.KNOT_AGENT_ENV_DIR || path.join(root, "sites", process.env.KNOT_SITE || "", "agents");
const { databaseUrl } = loadBootstrapConfig();
const pool = new pg.Pool({ connectionString: databaseUrl });

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

let code = 0;
try {
  const owner = await pool.query(`SELECT id FROM accounts WHERE role = 'owner' LIMIT 1`);
  const ownerId = owner.rows[0]?.id;
  if (!ownerId) throw new Error("owner_unconfigured");

  const found = await pool.query(
    `SELECT id, role, owner_id, display_name, retired_at FROM accounts
      WHERE lower(btrim(display_name)) = lower(btrim($1))`,
    [name]
  );
  const existing = found.rows[0];
  // 这个称呼属于别人（外部账号的 Agent，或某个人的账号）：不能借运维脚本改它的令牌。
  if (existing && (existing.role !== "agent" || existing.owner_id !== ownerId)) {
    throw new Error("name_taken");
  }
  if (existing && !existing.retired_at) {
    const known = { id: existing.id, displayName: existing.display_name };
    const envFile = await agentEnvFileFor(envDir, known);
    if (await fileExists(envFile)) {
      console.log(`${existing.display_name} ${existing.id} 已有授权码 ${envFile}`);
    } else {
      const rotated = await rotateAgentToken(pool, existing.id);
      const written = await writeAgentEnvFile(envDir, rotated);
      console.log(`${rotated.displayName} ${rotated.id}`);
      console.log(`授权码已写入 ${written}`);
    }
  } else {
    const issued = existing
      ? await reviveAgent(pool, existing.id)
      : await createAgent(pool, { ownerId, name });
    const envFile = await writeAgentEnvFile(envDir, issued);
    console.log(`${issued.displayName} ${issued.id}`);
    console.log(`授权码已写入 ${envFile}`);
  }
} catch (error) {
  console.error(error.code || error.message);
  code = 1;
} finally {
  await pool.end();
}
process.exit(code);
