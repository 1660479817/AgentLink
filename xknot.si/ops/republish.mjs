// 运行期重算门户快照：把 data/hub.json 重新生成一遍并原子落盘。
//
// 为什么要有这一步：门户是静态站，卡片来自构建期写下的 data/hub.json。
// 节点接通时 worker 只把 instances.json 里的 status 改成 active，没有任何人
// 重算这份快照，于是「节点已经在线、首页还没有卡片」会一直停留到下一次人工
// 构建。接通是既成事实，快照得跟着变。
//
// 与 ops/build-hub.sh 的分工：
//   build-hub.sh 出整站产物（Vite、字体、文档页），要 node_modules、要网络；
//   这里只重算**数据这一段**（hub.json），输入全是磁盘上的清单、探测、档案与
//   流量结果，不打包、不碰 dist 里的资产。所以中枢主机不装前端工具链也能用，
//   接通后几秒内就能把卡片挂上。
//
// 两条约束：
//   1. 快照没通过 ops/verify-hub-data.mjs 就不落盘（宁可不更新，也不发一份坏的）；
//   2. 档案取不回来不影响发布：卡片退回 id，档案由下一轮补。门户不能因为某个
//      伙伴的 /api/federation/profile 超时就整份停更。
//
// 用法：
//   node ops/republish.mjs                                   # 写 web/dist/data/hub.json
//   node ops/republish.mjs --out /var/www/xknot/data/hub.json --quiet
//   node ops/republish.mjs --no-fetch                        # 只重算，不拉档案

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildHubData } from "../web/src/lib/snapshot.js";
import { readCards } from "./cards.mjs";
import { run as fetchProfiles } from "./fetch-profile.mjs";
import { readProfiles } from "./profiles.mjs";
import { readStats } from "./stats.mjs";
import { verifyHubData } from "./verify-hub-data.mjs";
import { invokedDirectly } from "./lib/main-module.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * 重算一次快照。
 *
 * @returns {Promise<{ outFile: string, count: number, warnings: string[] }>}
 */
export async function republish(options = {}) {
  const {
    root = ROOT,
    dataDir = process.env.XKNOT_DATA_DIR ? path.resolve(process.env.XKNOT_DATA_DIR) : path.join(root, "var"),
    instancesPath = process.env.XKNOT_INSTANCES_FILE
      ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
      : path.join(root, "instances.json"),
    outFile = process.env.XKNOT_WEB_ROOT
      ? path.join(path.resolve(process.env.XKNOT_WEB_ROOT), "data", "hub.json")
      : path.join(root, "web", "dist", "data", "hub.json"),
    // 名字里不带 fetch：那个名字留给全局的那个，避免形参与全局同名后互相遮蔽。
    doFetch = true,
    fetchImpl = globalThis.fetch,
    now = () => new Date(),
    log = () => {},
  } = options;
  const warnings = [];

  const manifest = await readJson(instancesPath, null);
  if (!manifest || !Array.isArray(manifest.instances)) {
    throw new Error(`cannot read instances: ${instancesPath}`);
  }

  if (doFetch) {
    // 档案取回是「尽力而为」：目录不可写、某个伙伴超时，都只记一条，接着发布。
    try {
      const results = await fetchProfiles({
        instancesPath,
        outDir: path.join(dataDir, "profiles"),
        fetchImpl,
        log,
      });
      for (const result of results) {
        if (result.status === "failed" || result.status === "invalid") {
          warnings.push(`${result.id}: profile ${result.status}${result.error ? ` ${result.error}` : ""}`);
        }
      }
    } catch (error) {
      warnings.push(`profile fetch skipped: ${error.message}`);
    }
  }

  const [health, cards, stats, profiles] = await Promise.all([
    readJson(path.join(dataDir, "health.json"), { instances: {} }),
    readCards(path.join(dataDir, "cards")),
    readStats(path.join(dataDir, "stats")),
    readProfiles(path.join(dataDir, "profiles")),
  ]);

  const data = buildHubData(manifest, health, now(), cards, stats, profiles);

  // 生产快照的守卫照旧：多一条、少一条、pending 漏出去都要挡住。
  // 但「没有档案」不拦发布——那是下一轮就能补上的展示细节，不该让整站停更。
  const problems = verifyHubData({ data, manifest, requireProfile: false });
  if (problems.length) {
    throw new Error(`snapshot rejected: ${problems.join("; ")}`);
  }
  for (const item of data.instances) {
    if (!item.profileFetchedAt) warnings.push(`${item.id}: no site profile yet, the card shows the id`);
  }

  // 先写同目录临时文件再 rename：门户随时可能在读这一份，不能让它读到半份 JSON。
  await mkdir(path.dirname(outFile), { recursive: true });
  const temp = `${outFile}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temp, outFile);

  return { outFile, count: data.instances.length, warnings };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === "--out") args.outFile = path.resolve(argv[++i]);
    else if (name === "--data") args.dataDir = path.resolve(argv[++i]);
    else if (name === "--instances") args.instancesPath = path.resolve(argv[++i]);
    else if (name === "--no-fetch") args.doFetch = false;
    else if (name === "--quiet") args.quiet = true;
  }
  return args;
}

const isMain = invokedDirectly(import.meta.url);

if (isMain) {
  const { quiet = false, ...rest } = parseArgs(process.argv.slice(2));
  const log = quiet ? () => {} : (line) => console.log(line);
  republish({ ...rest, log })
    .then(({ outFile, count, warnings }) => {
      for (const warning of warnings) console.log(`warning: ${warning}`);
      console.log(`${outFile}: ${count} instance(s)`);
    })
    .catch((error) => {
      console.error(`republish failed: ${error.message}`);
      process.exitCode = 1;
    });
}
