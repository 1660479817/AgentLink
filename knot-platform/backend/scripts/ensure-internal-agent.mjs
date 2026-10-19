import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import { ensureInternalAgent, internalAgentName, writeAgentEnvFile } from "../src/internalAgent.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const name = internalAgentName(process.argv[2]);
if (!name) {
  console.error("称呼用 1 到 40 个字，字母或数字开头，不要空格和斜线");
  process.exit(1);
}

const { databaseUrl } = loadBootstrapConfig();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let issued;
try {
  issued = await ensureInternalAgent(client, name);
} finally {
  await client.end();
}

if (issued.token) {
  const tokenFile = await writeAgentEnvFile(path.join(root, "ops", "env"), issued);
  console.log(`${issued.displayName} ${issued.userId}`);
  console.log(`授权码已写入 ${tokenFile}`);
} else {
  console.log(`${issued.displayName} ${issued.userId} 已有授权码`);
}
