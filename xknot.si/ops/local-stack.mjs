// 本地部署：把接口和门户静态站按线上的形态拉起来。
//
// 线上是两个进程（systemd 的 xknot-api + nginx）。本地同样是两个：
//   server/index.mjs   只监听回环，数据放 var/ 下独立目录
//   ops/local-hub.mjs  静态站 + /api /admin 反代，补同一组安全头
//
// 单独跑：
//   node ops/local-stack.mjs                 # 仓库清单，127.0.0.1:5190，数据在 var/local
//   node ops/local-stack.mjs --preview       # 门户数据并进 fixtures 样例
//   node ops/local-stack.mjs --admin paul:correct-horse-battery
//   node ops/local-stack.mjs --port 8080 --data-dir /tmp/xknot
//
// 命令行启动时数据目录保留，重启后申请与审核记录还在。
// 端到端测试直接 import startStack()，拿到随机端口、临时数据目录和停止函数。

import { spawn, execFile } from "node:child_process";
import { openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startEntry } from "./local-hub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER = path.join(ROOT, "server", "index.mjs");
const CLI = path.join(ROOT, "server", "admin-cli.mjs");

export const DEFAULT_MANIFEST = {
  version: 4,
  updatedAt: "2026-01-01",
  instances: [
    {
      id: "e2e-node",
      url: "https://e2e-node.xknot.si",
      since: "2026-01-01",
      // 名册里它是 founder；validateRoster 要求创始实例 tier 为 paid。
      tier: "paid",
      status: "active",
    },
    {
      id: "e2e-paused",
      url: "https://e2e-paused.xknot.si",
      since: "2026-01-01",
      tier: "free",
      status: "suspended",
    },
  ],
};

// 与 DEFAULT_MANIFEST 对齐的测试名册：publish 写名册时要用它做交叉校验。
export const DEFAULT_ROSTER = {
  version: 1,
  updatedAt: "2026-01-01",
  hub: "xknot.si",
  members: [
    {
      id: "e2e-node",
      host: "e2e-node.xknot.si",
      role: "founder",
      standing: "permanent",
      tunnel: { account: "knot-tunnel", port: 18080 },
      listed: true,
      since: "2026-01-01",
      mode: "subdomain",
    },
    {
      id: "e2e-paused",
      host: "e2e-paused.xknot.si",
      role: "partner",
      standing: "regular",
      tunnel: { account: "knot-tunnel-paused", port: 18081 },
      listed: true,
      since: "2026-01-01",
      mode: "subdomain",
    },
  ],
};

// 测试清单的站点自述：名称与联系邮箱属于自述区，清单里只留签发区。
// 这两个 id 之外的自述由调用方自己往 dataDir/profiles 里放。
export const DEFAULT_SITES = {
  "e2e-node": {
    name: "端到端节点",
    tagline: "只在测试里存在的节点。",
    owner: "E2E",
    contact: "ops@e2e-node.example",
    region: "SG",
    timezone: "Asia/Singapore",
    tags: ["测试"],
  },
  "e2e-paused": {
    name: "暂停节点",
    tagline: "用于委托发信拒绝测试的暂停节点。",
    owner: "E2E",
    contact: "ops@e2e-paused.example",
    region: "DE",
    timezone: "Europe/Berlin",
    tags: ["测试"],
  },
};

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function cleanEnv(extra) {
  const env = { ...process.env };
  // 不把开发机上随手 export 的发信配置带进本地栈，否则 relay 是否可用不可控。
  for (const name of Object.keys(env)) {
    if (name.startsWith("SMTP_") || name.startsWith("XKNOT_")) delete env[name];
  }
  return { ...env, ...extra };
}

async function readTail(file, lines = 20) {
  try {
    const text = await readFile(file, "utf8");
    return text.trim().split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}

async function waitForHealth(apiUrl, { timeoutMs = 15_000, child } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "timeout";
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`api exited early (code ${child.exitCode})`);
    try {
      const response = await fetch(`${apiUrl}/api/health`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`api did not become healthy: ${lastError}`);
}

/**
 * 拉起一套本地部署。
 *
 * @param {object} options
 * @param {boolean} [options.preview] 门户数据并进 fixtures 样例（浏览器测试用）
 * @param {object} [options.manifest] 写一份测试清单；不传则用仓库 instances.json
 * @param {Record<string,string>} [options.env] 额外环境变量（如 SMTP_*）
 * @param {string} [options.distDir] 静态站目录，默认 web/dist
 * @param {string} [options.dataDir] 数据目录，默认 var/e2e/<随机>
 * @param {boolean} [options.keep] 停止时保留数据目录
 */
export async function startStack(options = {}) {
  const {
    preview = false,
    manifest = null,
    roster = null,
    instancesFile: instancesFileOption = null,
    federationFile: federationFileOption = null,
    env = {},
    distDir = path.join(ROOT, "web", "dist"),
    dataDir = path.join(ROOT, "var", "e2e", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    entryPort = 0,
    admin = null,
    keep = false,
  } = options;

  await mkdir(dataDir, { recursive: true });
  const apiPort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  // 控制台能改实例配置，所以测试必须指向一份临时清单：直接改仓库里的
  // instances.json 会让一次测试污染真实清单。传 instancesFile 就原地用那份。
  let federationFile = federationFileOption ? path.resolve(federationFileOption) : null;
  if (roster) {
    federationFile = path.join(dataDir, "federation.json");
    await writeFile(federationFile, `${JSON.stringify(roster, null, 2)}\n`, "utf8");
  }
  let manifestFile = instancesFileOption ? path.resolve(instancesFileOption) : null;
  if (manifest) {
    manifestFile = path.join(dataDir, "instances.json");
    await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  let dataFile = null;
  if (!preview && manifest) {
    // 测试清单也要有对应的快照，否则 /data/hub.json 还停在仓库上次构建的内容。
    const { buildHubData } = await import("../web/src/lib/snapshot.js");
    const { readProfiles } = await import("./profiles.mjs");
    const profilesDir = path.join(dataDir, "profiles");
    await mkdir(profilesDir, { recursive: true });
    // 名称、联系邮箱属于自述区：默认清单的两条各配一份副本，界面上才有名字可显示。
    for (const instance of manifest.instances || []) {
      const site = DEFAULT_SITES[instance?.id];
      if (!site) continue;
      await writeFile(
        path.join(profilesDir, `${instance.id}.json`),
        `${JSON.stringify(
          { formatVersion: 2, fetchedAt: new Date().toISOString(), issued: instance, site },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
    const profiles = await readProfiles(profilesDir);
    dataFile = path.join(dataDir, "hub.json");
    await writeFile(
      dataFile,
      `${JSON.stringify(buildHubData(manifest, { instances: {} }, new Date(), {}, {}, profiles), null, 2)}\n`,
      "utf8"
    );
  }
  if (preview) {
    dataFile = path.join(dataDir, "hub.preview.json");
    await new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(ROOT, "ops", "build-hub-data.mjs"), "--out", dataFile],
        { cwd: ROOT, env: { ...process.env, XKNOT_PREVIEW: "1" } },
        (error, _stdout, stderr) => (error ? reject(new Error(stderr || error.message)) : resolve())
      );
    });
  }

  const logFile = path.join(dataDir, "api.log");
  const log = openSync(logFile, "a");
  // dataDir 是调用方给的路径，递归删除只在它落在 var/e2e/ 下时才做：
  // 被当成库调用却传了真实目录时，停一次服务就会把整目录删掉。
  const e2eRoot = path.join(ROOT, "var", "e2e") + path.sep;
  const canRemove = path.resolve(dataDir).startsWith(e2eRoot);
  const cleanDataDir = async () => {
    if (keep) return;
    if (!canRemove) {
      // 不是本次测试占用的目录：只清自己写进去的日志，别动别人的数据。
      await rm(logFile, { force: true }).catch(() => {});
      return;
    }
    await rm(dataDir, { recursive: true, force: true }).catch(() => {});
  };

  const api = spawn(process.execPath, [SERVER], {
    cwd: ROOT,
    env: cleanEnv({
      XKNOT_API_HOST: "127.0.0.1",
      XKNOT_API_PORT: String(apiPort),
      XKNOT_DATA_DIR: path.join(dataDir, "data"),
      // 自述区副本跟这次测试走，别读到仓库里上次取回的那一份。
      XKNOT_PROFILES_DIR: path.join(dataDir, "profiles"),
      XKNOT_TRUST_PROXY: "1",
      XKNOT_PUBLIC_ORIGIN: apiUrl,
      ...(manifestFile ? { XKNOT_INSTANCES_FILE: manifestFile } : {}),
      ...(federationFile ? { XKNOT_FEDERATION_FILE: federationFile } : {}),
      ...env,
    }),
    stdio: ["ignore", log, log],
  });

  try {
    await waitForHealth(apiUrl, { child: api });
  } catch (error) {
    api.kill("SIGKILL");
    const tail = await readTail(logFile);
    throw new Error(`${error.message}\n--- api.log ---\n${tail}`);
  }

  // 起入口之前的任何失败都要把接口收掉：否则子进程活着，测试进程不会退出，
  // 报错就变成一条挂住的命令（缺 web/dist 时会这样）。
  let entry;
  try {
    // 管理员在建入口之前建好：外部（Playwright 的 webServer）以入口的健康检查
    // 作为“可以开始”的信号，不能在它之后才建账号。
    if (admin?.username) {
      await createAdmin(dataDir, {
        username: admin.username,
        password: admin.password,
        ...(manifestFile ? { XKNOT_INSTANCES_FILE: manifestFile } : {}),
      });
    }

    entry = await startEntry({ distDir, apiBase: apiUrl, port: entryPort, dataFile });
  } catch (error) {
    api.kill("SIGKILL");
    await cleanDataDir();
    throw error;
  }

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    await entry.close().catch(() => {});
    if (api.exitCode === null) {
      api.kill("SIGTERM");
      const exited = await Promise.race([
        new Promise((resolve) => api.once("exit", () => resolve(true))),
        new Promise((resolve) => setTimeout(() => resolve(false), 3000)),
      ]);
      if (!exited) api.kill("SIGKILL");
    }
    await cleanDataDir();
  }

  async function setManifest(next) {
    const file = manifestFile || path.join(dataDir, "instances.json");
    await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    return file;
  }

  // 端到端要用运维同款命令，并且让 CLI 读同一份测试清单与名册。
  const cliEnv = {
    ...(manifestFile ? { XKNOT_INSTANCES_FILE: manifestFile } : {}),
    ...(federationFile ? { XKNOT_FEDERATION_FILE: federationFile } : {}),
  };

  return {
    portalUrl: entry.url,
    apiUrl,
    dataDir,
    distDir,
    apiPort,
    apiPid: api.pid,
    manifestFile,
    federationFile,
    logFile,
    setManifest,
    adminCli: (args, extraEnv = {}) => adminCli(dataDir, args, { ...cliEnv, ...extraEnv }),
    createAdmin: (username, password) => createAdmin(dataDir, { username, password, ...cliEnv }),
    issueRelayToken: (instance, extraArgs = []) =>
      issueRelayToken(dataDir, instance, extraArgs, cliEnv),
    stop,
  };
}

/**
 * 用运维同款命令建管理员。
 * @param {string} dataDir
 * @param {{username: string, password: string, XKNOT_INSTANCES_FILE?: string}} options
 */
export function createAdmin(dataDir, { username, password, ...extraEnv }) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, "create-admin", username],
      {
        cwd: ROOT,
        env: cleanEnv({
          XKNOT_DATA_DIR: path.join(dataDir, "data"),
          XKNOT_ADMIN_PASSWORD: password,
          ...extraEnv,
        }),
      },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || stdout || error.message));
        resolve(stdout.trim());
      }
    );
  });
}

/**
 * 用运维同款命令签发委托发信凭据，返回明文令牌。
 * @param {string} dataDir
 * @param {string} instance
 * @param {string[]} [extraArgs]
 * @param {{XKNOT_INSTANCES_FILE?: string}} [extraEnv]
 */
export function issueRelayToken(dataDir, instance, extraArgs = [], extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, "relay-token", instance, ...extraArgs],
      { cwd: ROOT, env: cleanEnv({ XKNOT_DATA_DIR: path.join(dataDir, "data"), ...extraEnv }) },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || stdout || error.message));
        // 输出里还有说明和吊销提示，凭据本身是唯一一行 xkr_ 开头的。
        const token = stdout
          .split("\n")
          .map((line) => line.trim())
          .find((line) => /^xkr_[a-z0-9-]+_[A-Za-z0-9_-]{16,}$/.test(line));
        if (!token) return reject(new Error(`unexpected relay-token output:\n${stdout}`));
        resolve(token);
      }
    );
  });
}

/** 用运维同款命令执行任意子命令，返回 stdout。 */
export function adminCli(dataDir, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd: ROOT, env: cleanEnv({ XKNOT_DATA_DIR: path.join(dataDir, "data"), ...extraEnv }) },
      (error, stdout, stderr) => {
        if (error) return reject(new Error(stderr || stdout || error.message));
        resolve(stdout);
      }
    );
  });
}

async function main(argv) {
  const preview = argv.includes("--preview");
  const adminArg = argv.includes("--admin") ? argv[argv.indexOf("--admin") + 1] : null;
  const portIndex = argv.indexOf("--port");
  // 命令行是给人用的“部署”，端口与数据目录都给稳定的默认值：
  // 刷新页面还在、重启后申请与审核记录还在。测试用 startStack() 的随机端口
  // 与临时目录，互不影响。
  // 5180 留给 `npm run dev`（Vite），部署默认单独占 5190。
  const entryPort = portIndex >= 0 ? Number(argv[portIndex + 1]) : 5190;
  const dataIndex = argv.indexOf("--data-dir");
  const dataDir = dataIndex >= 0 ? path.resolve(argv[dataIndex + 1]) : path.join(ROOT, "var", "local");
  // 控制台可以改配置：这两项让本地栈指向一份临时清单与名册，不碰仓库里的文件。
  const instancesIndex = argv.indexOf("--instances");
  const instancesFile = instancesIndex >= 0 ? path.resolve(argv[instancesIndex + 1]) : null;
  const federationIndex = argv.indexOf("--federation");
  const federationFile = federationIndex >= 0 ? path.resolve(argv[federationIndex + 1]) : null;

  let admin = null;
  // 口令可以从环境变量给：写在命令行里会进 `ps aux` 与日志。测试装置用这个入口，
  // 参数形式留给手动起栈的人。
  const adminSpec = adminArg || process.env.XKNOT_E2E_ADMIN || null;
  if (adminSpec) {
    const [username, ...rest] = adminSpec.split(":");
    const password = rest.join(":");
    if (!username || !password) throw new Error("--admin 格式：<user>:<password>");
    admin = { username, password };
  }

  const stack = await startStack({
    preview,
    entryPort,
    admin,
    dataDir,
    keep: true,
    instancesFile,
    federationFile,
  });
  if (admin) console.log(`admin ${admin.username} ready`);

  console.log("");
  console.log(`  portal  ${stack.portalUrl}/en/`);
  console.log(`  admin   ${stack.portalUrl}/admin/`);
  console.log(`  api     ${stack.apiUrl}/api/health`);
  console.log(`  data    ${stack.dataDir}`);
  console.log(`  preview ${preview ? "on (fixtures)" : "off (仓库清单)"}`);
  console.log("");
  console.log("Ctrl-C 停止。");

  const stop = async (code = 0) => {
    await stack.stop();
    process.exit(code);
  };
  process.on("SIGINT", () => stop(0));
  process.on("SIGTERM", () => stop(0));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main(process.argv.slice(2)).catch(async (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
