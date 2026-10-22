// 拉取伙伴地址时的统一守卫。
//
// 清单是人工收录的，但 URL 仍然按不可信地址处理（docs/FEDERATION.md 第 6.6 节）：
// 只允许 https、不带凭据、不跟随重定向、限时、限大小，解析 DNS 后拒绝回环、
// 私有网段、链路本地与云元数据地址。健康探测、橱窗拉取、活动数据共用这一份。

import { lookup } from "node:dns/promises";
import { mkdir, rename, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

export const DEFAULT_TIMEOUT_MS = 5000;
export const CARDS_MAX_BYTES = 256 * 1024;
export const STATS_MAX_BYTES = 32 * 1024;
export const PROFILE_MAX_BYTES = 64 * 1024;
export const USER_AGENT = "xknot-hub/1.0 (+https://xknot.si)";

export class FetchGuardError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function ipv4Public(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // 链路本地 / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && parts[2] === 0) return false; // IETF 协议分配
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // 基准测试
  if (a === 198 && b === 51 && parts[2] === 100) return false; // 文档网段
  if (a === 203 && b === 0 && parts[2] === 113) return false; // 文档网段
  if (a >= 224) return false; // 组播与保留
  return true;
}

// 把 IPv6 展开成 8 个 16 位整数。地址里的内嵌 IPv4（::ffff:127.0.0.1）
// 先换成两个十六进制段，再统一按段判断，避免点分和十六进制两种写法绕过。
function ipv6Hextets(address) {
  let text = String(address).toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(text)) return null;

  if (text.includes(".")) {
    const colon = text.lastIndexOf(":");
    if (colon < 0) return null;
    const tail = text.slice(colon + 1);
    if (net.isIP(tail) !== 4) return null;
    const [a, b, c, d] = tail.split(".").map(Number);
    text = `${text.slice(0, colon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part) => (part ? part.split(":") : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const missing = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (missing < 0) return null;
  const parts = [...head, ...Array(missing).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => parseInt(part, 16));
}

function embeddedIpv4(high, low) {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function ipv6Public(address) {
  const h = ipv6Hextets(address);
  if (!h) return false;

  // ::ffff:0:0/96 是 IPv4 映射地址，按内嵌的 IPv4 判断；
  // ::/96（兼容地址）与 ::、::1 一律拒绝。
  if (h.slice(0, 5).every((part) => part === 0) && h[5] === 0xffff) {
    return ipv4Public(embeddedIpv4(h[6], h[7]));
  }

  // 只放行 2000::/3 全球单播。fc00::/7、fe80::/10、ff00::/8、::/96
  // 以及 IPv4 兼容地址都在这个范围之外，直接拒绝。
  if ((h[0] & 0xe000) !== 0x2000) return false;

  if (h[0] === 0x2002) return false; // 6to4，内嵌 IPv4，已废弃
  if (h[0] === 0x2001 && h[1] === 0x0000) return false; // Teredo 2001::/32
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false; // 文档网段
  if (h[0] === 0x2001 && h[1] === 0x0002) return false; // 基准测试 2001:2::/48
  if (h[0] === 0x2001 && (h[1] & 0xfff0) === 0x0010) return false; // ORCHID 2001:10::/28
  if (h[0] === 0x2001 && (h[1] & 0xfff0) === 0x0020) return false; // ORCHIDv2 2001:20::/28
  if (h[0] === 0x3ffe) return false; // 6bone

  return true;
}

/** 公网地址才放行；回环、私有、链路本地、云元数据一律拒绝。 */
export function isPublicAddress(address) {
  const family = net.isIP(String(address || ""));
  if (family === 4) return ipv4Public(String(address));
  if (family === 6) return ipv6Public(String(address));
  return false;
}

async function resolveAll(host) {
  if (net.isIP(host)) return [host];
  const records = await lookup(host, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

export { resolveAll as resolveHosts };

/**
 * 校验一个伙伴地址，返回解析后的 URL。任何一条解析结果落在非公网就拒绝，
 * 避免轮询 DNS 时只检查其中一条。
 */
export async function assertPublicUrl(raw, { resolve = resolveAll } = {}) {
  let url;
  try {
    url = new URL(String(raw || ""));
  } catch {
    throw new FetchGuardError("invalid_url");
  }
  if (url.protocol !== "https:") throw new FetchGuardError("insecure_url");
  if (url.username || url.password) throw new FetchGuardError("credentials_in_url");
  if (!url.hostname) throw new FetchGuardError("invalid_url");

  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = await resolve(host);
  } catch {
    throw new FetchGuardError("unresolvable");
  }
  if (!Array.isArray(addresses) || !addresses.length) throw new FetchGuardError("unresolvable");
  for (const address of addresses) {
    if (!isPublicAddress(address)) throw new FetchGuardError("private_address");
  }
  return url;
}

async function readLimited(response, maxBytes) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new FetchGuardError("too_large");
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new FetchGuardError("too_large");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value?.length || 0;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchGuardError("too_large");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * GET 一份 JSON。304 原样返回，交给调用方保留上一份。
 * @returns {Promise<{status:number, url:string, body?:unknown, etag?:string|null}>}
 */
export async function safeGetJson(raw, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = CARDS_MAX_BYTES,
    fetchImpl = fetch,
    resolve,
    etag = null,
  } = options;

  const url = await assertPublicUrl(raw, { resolve });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { accept: "application/json", "user-agent": USER_AGENT };
  if (etag) headers["if-none-match"] = etag;

  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers,
    });

    if (response.status === 304) return { status: 304, url: url.toString() };
    if (response.status >= 300 && response.status < 400) throw new FetchGuardError("redirect");
    if (response.status !== 200) throw new FetchGuardError(`http_${response.status}`);

    const text = await readLimited(response, maxBytes);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new FetchGuardError("bad_json");
    }
    return {
      status: 200,
      url: url.toString(),
      body,
      etag: response.headers?.get?.("etag") || null,
    };
  } catch (error) {
    if (error instanceof FetchGuardError) throw error;
    throw new FetchGuardError(error?.name === "AbortError" ? "timeout" : "unreachable");
  } finally {
    clearTimeout(timer);
  }
}

/** 原子写：临时文件 + rename，失败时上一份原样保留。 */
export async function writeJsonAtomic(file, payload) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tmp, file);
}
