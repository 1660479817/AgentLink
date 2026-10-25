// 节点状态：把分散的采集结果合成一份 var/status.json。
//
// 现在的采集各有各的节拍：健康每 15 分钟、隧道对端 60 秒、位置跟着对端、
// 流量每天、接通 20 秒。让它们抢着写同一份文件只会引入锁与覆盖，所以这里
// 不做「唯一写入方」，只做一层**纯组合**：谁采完谁调用 refreshStatus()，
// 重读各源文件、整份重算、原子替换。最后写入者胜，最坏情况是快照晚一个节拍。
//
// 字段各带采集时间，所以「过时」是可见的：probe.checkedAt 是健康巡检的，
// tunnel.checkedAt 是对端采集的，traffic.date 是流量那一天。消费方不必猜。
//
// 用法：
//   node ops/node-status.mjs                 # 重算一次并打印
//   node ops/node-status.mjs --out var/status.json

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const STATUS_FILE = "status.json";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

export function hostOfUrl(raw) {
  try {
    return new URL(String(raw || "").trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// 流量按天存，展示只取最近一天。没有采集过就是 null，不写 0。
export function summarizeTraffic(doc) {
  const days = Array.isArray(doc?.days) ? doc.days : [];
  const latest = days.find((day) => day && typeof day.date === "string");
  if (!latest) return null;
  return {
    date: latest.date,
    requests: Number(latest.requests) || 0,
    bytes: Number(latest.bytes) || 0,
    updatedAt: doc?.updatedAt || null,
  };
}

function probeOf(health, id) {
  const raw = health?.instances && typeof health.instances === "object" ? health.instances[id] : null;
  if (!raw || typeof raw !== "object") return null;
  return {
    status: raw.status || "unknown",
    latencyMs: Number.isFinite(raw.latencyMs) ? raw.latencyMs : null,
    version: typeof raw.version === "string" ? raw.version : null,
    error: typeof raw.error === "string" ? raw.error : null,
    lastOkAt: raw.lastOkAt || null,
    downSince: raw.downSince || null,
    hidden: Boolean(raw.hiddenAt),
    checkedAt: health?.checkedAt || null,
  };
}

function memberOf(federation, instance) {
  const members = Array.isArray(federation?.members) ? federation.members : [];
  const host = hostOfUrl(instance?.url);
  return (
    members.find((member) => String(member?.id || "") === String(instance?.id || "")) ||
    members.find((member) => String(member?.host || "").toLowerCase() === host) ||
    null
  );
}

/**
 * 合成一个节点。清单只给身份，探测只给可达性，对端只给隧道，
 * 位置与流量各自带自己的时间。这里不推导展示状态（pending / paused 之类的
 * 颜色由控制台自己决定），只把事实放在一起。
 */
export function composeNode({ instance, member, health, peers, locations, traffic }) {
  const id = String(instance?.id || "");
  const probe = probeOf(health, id);
  const peer = peers?.peers && typeof peers.peers === "object" ? peers.peers[id] : null;
  const location = locations?.locations && typeof locations.locations === "object" ? locations.locations[id] : null;
  const tunnel = member?.tunnel && typeof member.tunnel === "object" ? member.tunnel : null;

  return {
    id,
    host: hostOfUrl(instance?.url),
    url: instance?.url || "",
    manifest: {
      // 照抄清单，缺项就是 null。这里不替中枢补档位或状态：node-status 是回读，
      // 不是决策点。
      status: instance?.status ?? null,
      tier: instance?.tier ?? null,
      since: instance?.since || null,
    },
    probe,
    // 对端在不在，和 HTTP 通不通是两件事：隧道没连与隧道连着但后端 502，
    // 排查方向完全不同。这里不写 IP，IP 仍只留在 var/peers.json。
    tunnel: {
      connected: Boolean(peer),
      account: tunnel?.account || peer?.account || null,
      port: Number.isInteger(tunnel?.port) ? tunnel.port : null,
      checkedAt: peers?.collectedAt || null,
    },
    location: location
      ? { country: location.country || null, source: location.source || null, at: location.at || null }
      : null,
    traffic: summarizeTraffic(traffic?.[id]),
  };
}

export function composeStatus({
  instances,
  federation,
  health,
  peers,
  locations,
  traffic,
  generatedAt = new Date().toISOString(),
} = {}) {
  const nodes = {};
  for (const instance of Array.isArray(instances) ? instances : []) {
    if (!instance?.id) continue;
    const id = String(instance.id);
    nodes[id] = composeNode({
      instance,
      member: memberOf(federation, instance),
      health,
      peers,
      locations,
      traffic,
    });
  }
  return { generatedAt, nodes };
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

async function readTrafficDir(dir) {
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return {};
  }
  const out = {};
  await Promise.all(
    names
      .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
      .map(async (name) => {
        const doc = await readJson(path.join(dir, name), null);
        if (!doc) return;
        const id = typeof doc.id === "string" && doc.id ? doc.id : name.slice(0, -".json".length);
        out[id] = doc;
      })
  );
  return out;
}

export async function loadSources({
  dataDir = path.join(ROOT, "var"),
  instancesPath = process.env.XKNOT_INSTANCES_FILE
    ? path.resolve(process.env.XKNOT_INSTANCES_FILE)
    : path.join(ROOT, "instances.json"),
  federationPath = process.env.XKNOT_FEDERATION_FILE
    ? path.resolve(process.env.XKNOT_FEDERATION_FILE)
    : path.join(ROOT, "federation.json"),
} = {}) {
  const [instancesDoc, federation, health, peers, locations, traffic] = await Promise.all([
    readJson(instancesPath, { instances: [] }),
    readJson(federationPath, { members: [] }),
    readJson(path.join(dataDir, "health.json"), { instances: {} }),
    readJson(path.join(dataDir, "peers.json"), { peers: {} }),
    readJson(path.join(dataDir, "geoip", "locations.json"), { locations: {} }),
    readTrafficDir(path.join(dataDir, "traffic")),
  ]);
  return {
    instances: Array.isArray(instancesDoc?.instances) ? instancesDoc.instances : [],
    federation,
    health,
    peers,
    locations,
    traffic,
  };
}

/**
 * 重读所有源文件，整份重算并原子写回。任何一步读不到都只是少一个字段，
 * 不抛错：状态文档不该因为某份采集文件还没生成而整份消失。
 */
export async function refreshStatus(options = {}) {
  const {
    outPath,
    dataDir = path.join(ROOT, "var"),
    now = () => new Date(),
    ...rest
  } = options;
  const sources = await loadSources({ dataDir, ...rest });
  const status = composeStatus({ ...sources, generatedAt: now().toISOString() });
  const file = outPath || path.join(dataDir, STATUS_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeJson(file, status);
  return { file, ...status };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (name === "--out") args.outPath = path.resolve(argv[++i]);
    else if (name === "--data") args.dataDir = path.resolve(argv[++i]);
    else if (name === "--instances") args.instancesPath = path.resolve(argv[++i]);
    else if (name === "--federation") args.federationPath = path.resolve(argv[++i]);
  }
  return args;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  refreshStatus(parseArgs(process.argv.slice(2)))
    .then((status) => {
      const nodes = Object.values(status.nodes);
      console.log(`${status.file}: ${nodes.length} 个节点`);
      for (const node of nodes) {
        const probe = node.probe ? `${node.probe.status}${node.probe.error ? ` (${node.probe.error})` : ""}` : "未探测";
        const tunnel = node.tunnel.connected ? "隧道在" : "隧道不在";
        const traffic = node.traffic ? `${node.traffic.date} ${node.traffic.requests} 次` : "无流量数据";
        console.log(`${node.id.padEnd(16)} ${probe.padEnd(18)} ${tunnel.padEnd(8)} ${traffic}`);
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
