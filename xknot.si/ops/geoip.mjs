// 出口 IP → 国家：把隧道对端的地址换成门户上显示的区域。
//
// 数据用 DB-IP 的免费库（Lite，CC BY 4.0，https://db-ip.com）：每月一份 CSV，
// 三列 `起始,结束,国家码`，IPv4 与 IPv6 混在同一个文件里。它不需要账号、
// 不需要 license key，也不会因为商用要另买授权 —— 这个仓库不带任何 npm 依赖，
// 所以自己解析，不引 MaxMind 那个 mmdb 读库。
//
// 只解析「这一次要判的地址」：库里 71 万行，解析一次约 0.2 秒、临时占一百来兆。
// 结果写进 var/geoip/resolved.json 缓存 30 天，所以常态是零成本。
//
// 归属声明：位置数据来自 DB-IP（https://db-ip.com），CC BY 4.0。门户页脚与
// docs/HUB.md 都写明这一句，去掉署名就不该再用这份数据。

import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { invokedDirectly } from "./lib/main-module.mjs";

export const CACHE_TTL_DAYS = 30;
const DB_MAX_BYTES = 32 * 1024 * 1024;

export function monthOf(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(month) {
  const [year, index] = String(month).split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 2, 1));
  return monthOf(date);
}

export function dbUrl(month) {
  return `https://download.db-ip.com/free/dbip-country-lite-${month}.csv.gz`;
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temp, file);
}

// ---- IP ↔ 整数 ----

export function ipv4ToInt(ip) {
  const parts = String(ip).trim().split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function ipv6ToBigInt(ip) {
  const text = String(ip).trim().toLowerCase();
  if (!text.includes(":")) return null;
  const [head, tail] = text.split("::");
  const left = head ? head.split(":") : [];
  const right = tail === undefined ? [] : tail ? tail.split(":") : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined && left.length !== 8) return null;
  if (missing < 0) return null;
  const groups = [...left, ...Array(tail === undefined ? 0 : missing).fill("0"), ...right];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) + BigInt(parseInt(group, 16));
  }
  return value;
}

// ---- 解析 ----

/**
 * 把 DB-IP 的 CSV 解析成两张按起始地址升序的表。
 * IPv4 用数字（快、省内存），IPv6 用 BigInt（128 位放不进 Number）。
 */
export function parseRanges(text) {
  const v4 = { starts: [], ends: [], codes: [] };
  const v6 = { starts: [], ends: [], codes: [] };
  for (const line of String(text).split("\n")) {
    if (!line) continue;
    const first = line.indexOf(",");
    if (first < 0) continue;
    const second = line.indexOf(",", first + 1);
    if (second < 0) continue;
    const code = line.slice(second + 1).trim();
    if (!/^[A-Z]{2}$/.test(code)) continue;
    const start = line.slice(0, first);
    const end = line.slice(first + 1, second);
    if (start.includes(":")) {
      const from = ipv6ToBigInt(start);
      const to = ipv6ToBigInt(end);
      if (from == null || to == null) continue;
      v6.starts.push(from);
      v6.ends.push(to);
      v6.codes.push(code);
    } else {
      const from = ipv4ToInt(start);
      const to = ipv4ToInt(end);
      if (from == null || to == null) continue;
      v4.starts.push(from);
      v4.ends.push(to);
      v4.codes.push(code);
    }
  }
  return { v4: compact(v4, false), v6: compact(v6, true) };
}

// DB-IP 是按地址升序排的；真遇到乱序就排一次，不假设文件永远规整。
function compact(table, big) {
  const n = table.starts.length;
  const order = new Array(n);
  let sorted = true;
  for (let i = 0; i < n; i += 1) {
    order[i] = i;
    if (i > 0 && compare(table.starts[i], table.starts[i - 1], big) < 0) sorted = false;
  }
  if (!sorted) order.sort((a, b) => compare(table.starts[a], table.starts[b], big));
  const starts = big ? new Array(n) : new Uint32Array(n);
  const ends = big ? new Array(n) : new Uint32Array(n);
  const codes = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const at = order[i];
    starts[i] = table.starts[at];
    ends[i] = table.ends[at];
    codes[i] = table.codes[at];
  }
  return { starts, ends, codes };
}

function compare(a, b, big) {
  return big ? (a < b ? -1 : a > b ? 1 : 0) : a - b;
}

/** 查一个国家码；不在表里（含 ZZ）返回 null。 */
export function countryOf(table, ip) {
  const text = String(ip || "").trim();
  const wanted = text.includes(":") ? ipv6ToBigInt(text) : ipv4ToInt(text);
  if (wanted == null) return null;
  const side = text.includes(":") ? table?.v6 : table?.v4;
  if (!side?.starts?.length) return null;
  let lo = 0;
  let hi = side.starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (wanted < side.starts[mid]) hi = mid - 1;
    else if (wanted > side.ends[mid]) lo = mid + 1;
    else return side.codes[mid] === "ZZ" ? null : side.codes[mid];
  }
  return null;
}

// ---- 库文件 ----

async function exists(file) {
  try {
    const info = await stat(file);
    return info.size > 0 ? info : null;
  } catch {
    return null;
  }
}

async function download(url, file, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error(`${url}: empty`);
  if (buffer.length > DB_MAX_BYTES) throw new Error(`${url}: too large`);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, buffer);
  await rename(temp, file);
  return buffer;
}

/**
 * 确保本地有一份能用的库，返回该文件的缓冲区。
 * 当月还没发布时退到上个月：DB-IP 每月 1 日前后换文件，月初那几天容易空手。
 * 网络不通时用目录里最新的那一份：旧一个月的国界不会一夜之间全变，比没有强。
 */
export async function loadDb({ dir, now = new Date(), fetchImpl = globalThis.fetch } = {}) {
  const months = [monthOf(now), previousMonth(monthOf(now))];
  for (const month of months) {
    const file = path.join(dir, `dbip-country-lite-${month}.csv.gz`);
    if (await exists(file)) return { month, buffer: await readFile(file) };
  }
  let lastError = null;
  for (const month of months) {
    const file = path.join(dir, `dbip-country-lite-${month}.csv.gz`);
    try {
      return { month, buffer: await download(dbUrl(month), file, { fetchImpl }) };
    } catch (error) {
      lastError = error;
    }
  }
  const old = await newestLocal(dir);
  if (old) return old;
  throw new Error(`geoip database unavailable: ${lastError?.message || "unknown"}`);
}

async function newestLocal(dir) {
  try {
    const names = await readdir(dir);
    const usable = names
      .map((name) => /^dbip-country-lite-(\d{4}-\d{2})\.csv\.gz$/.exec(name))
      .filter(Boolean)
      .map((match) => match[1])
      .sort();
    const month = usable.at(-1);
    if (!month) return null;
    const file = path.join(dir, `dbip-country-lite-${month}.csv.gz`);
    return { month, buffer: await readFile(file) };
  } catch {
    return null;
  }
}

// ---- 采集结果 → 位置 ----

function staleOf(cache, ip, now, ttlDays) {
  const hit = cache?.[ip];
  // country 为 null 也是结论（这个地址查不到），一并缓存，不要每次都重查。
  if (!hit || !Object.hasOwn(hit, "country") || !hit.at) return true;
  const at = Date.parse(hit.at);
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > ttlDays * 24 * 3600_000;
}

/**
 * peers（实例 id → { ip, account }）换成 locations（实例 id → { country }）。
 * 查不到国家的条目整个不写：页面自己回落到自述区的 region，比写个「未知」好。
 */
export async function resolveLocations({
  dir,
  peers = {},
  now = new Date(),
  ttlDays = CACHE_TTL_DAYS,
  fetchImpl = globalThis.fetch,
} = {}) {
  const cacheFile = path.join(dir, "resolved.json");
  const locationsFile = path.join(dir, "locations.json");
  const cache = await readJson(cacheFile, {});

  const wanted = [...new Set(Object.values(peers).map((peer) => peer?.ip).filter(Boolean))];
  const stale = wanted.filter((ip) => staleOf(cache, ip, now, ttlDays));
  let error = null;
  if (stale.length) {
    // 拿不到库就只写还留在缓存里的答案：一次网络故障不该把已知位置清空。
    try {
      const { month, buffer } = await loadDb({ dir, now, fetchImpl });
      const table = parseRanges(gunzipSync(buffer).toString("utf8"));
      for (const ip of stale) {
        cache[ip] = { country: countryOf(table, ip), month, at: now.toISOString() };
      }
      await writeJson(cacheFile, cache);
    } catch (failure) {
      error = failure.message;
    }
  }

  const locations = {};
  for (const [id, peer] of Object.entries(peers)) {
    const hit = peer?.ip ? cache[peer.ip] : null;
    if (!hit?.country) continue;
    locations[id] = { country: hit.country, at: hit.at, source: "tunnel" };
  }
  const payload = { generatedAt: now.toISOString(), locations };
  await writeJson(locationsFile, payload);
  return { ...payload, file: locationsFile, resolved: error ? 0 : stale.length, error };
}

// ---- 命令行 ----

const isMain = invokedDirectly(import.meta.url);
if (isMain) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = process.env.XKNOT_GEOIP_DIR
    ? path.resolve(process.env.XKNOT_GEOIP_DIR)
    : path.join(here, "..", "var", "geoip");
  const peersFile = process.env.XKNOT_PEERS_FILE
    ? path.resolve(process.env.XKNOT_PEERS_FILE)
    : path.join(here, "..", "var", "peers.json");

  const ipIndex = process.argv.indexOf("--ip");
  if (ipIndex >= 0) {
    const ip = process.argv[ipIndex + 1];
    try {
      const { buffer } = await loadDb({ dir });
      const table = parseRanges(gunzipSync(buffer).toString("utf8"));
      console.log(`${ip}: ${countryOf(table, ip) || "unknown"}`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else {
    const saved = await readJson(peersFile, { peers: {} });
    const result = await resolveLocations({ dir, peers: saved.peers || {} });
    console.log(`${result.file}: ${Object.keys(result.locations).length} located, ${result.resolved} resolved`);
  }
}
