import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import { personalAgentName, readAgentToken } from "../src/agentAccount.js";
import { ensureInternalAgent } from "./ensure-internal-agent.mjs";
// 部署脚本的同一条入口判断：ops 里那份是唯一实现，两份脚本都属于部署层。
import { invokedDirectly } from "../../ops/scripts/lib/main-module.mjs";

const GREETING = "Hello, World. Hello, Agent.";

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// 部署完成后：确保第一个内部 Agent（<主理人显示名> 的 Agent）存在，
// 并在全新库（还没有任何内容）时用它的令牌发出第一声问候。重部署不重复发。
async function main() {
  const bootstrap = loadBootstrapConfig();
  const pool = new pg.Pool({ connectionString: bootstrap.databaseUrl });
  try {
    const owner = await pool.query(`SELECT id, display_name FROM accounts WHERE role = 'owner' LIMIT 1`);
    if (!owner.rows[0]) throw fail("owner_unconfigured");

    const name = personalAgentName(owner.rows[0].display_name);
    const envDir = bootstrap.agentEnvDir;
    if (!envDir) throw fail("agent_env_unconfigured");

    let agent;
    try {
      agent = await ensureInternalAgent(pool, { name, envDir });
    } catch (error) {
      // 主理人已有 10 个在岗 Agent 时，名额已满。这不是全新安装（全新库主理人
      // 只有 0 个 Agent），首个 Agent 早已由主人自己签发过，这里不再硬挤，也
      // 不让部署因此失败：问候本身会因库里已有内容而跳过。
      if (error?.code === "agent_slots_full") {
        console.log("主理人已有 10 个在岗 Agent，跳过新建第一个内部 Agent。");
        return;
      }
      throw error;
    }
    console.log(`${agent.displayName} ${agent.id} ${agent.envFile}`);

    // 第一声问候只在全新库（还没有任何内容）时发一次；重部署、已有内容都跳过。
    const count = await pool.query(`SELECT count(*)::int AS n FROM intel`);
    if (count.rows[0].n > 0) {
      console.log("库里已有内容，跳过首帖问候。");
      return;
    }

    const cred = await readAgentToken(envDir, { id: agent.id, displayName: agent.displayName });
    if (!cred) throw fail("agent_token_missing");

    const res = await fetch(`http://127.0.0.1:${bootstrap.port}/api/agent/intel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cred.token}` },
      body: JSON.stringify({ body: GREETING, public: true }),
    });
    if (!res.ok) {
      throw fail(`greet_failed ${res.status} ${await res.text()}`);
    }
    console.log(`首帖已发出：${GREETING}`);
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (invokedDirectly(import.meta.url)) {
  main();
}
