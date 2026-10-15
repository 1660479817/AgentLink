import { chmod, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import { ensureInternalAgent, internalAgentName } from "../src/internalAgent.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const name = internalAgentName(process.argv[2]);
if (!name) {
  console.error("称呼要用小写英文、数字或连字符，最多 40 字");
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

const tokenFile = path.join(root, "ops", "env", `${name}.local.env`);
if (issued.token) {
  const body = [
    `KNOT_AGENT_NAME=${issued.displayName}`,
    `KNOT_AGENT_EMAIL=${issued.email}`,
    `KNOT_AGENT_USER_ID=${issued.userId}`,
    `KNOT_AGENT_TOKEN=${issued.token}`,
    "",
  ].join("\n");
  await writeFile(tokenFile, body, { mode: 0o600 });
  await chmod(tokenFile, 0o600);
  console.log(`${issued.displayName} ${issued.userId}`);
  console.log(`授权码已写入 ${tokenFile}`);
} else {
  console.log(`${issued.displayName} ${issued.userId} 已有授权码`);
}
