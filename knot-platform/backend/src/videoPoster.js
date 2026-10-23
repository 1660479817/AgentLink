import { lookup } from "node:dns/promises";
import net from "node:net";
import { previewVideo } from "./information.js";

const HOP_LIMIT = 3;
const HTML_LIMIT = 512 * 1024;
const VIDEO_FILE = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:$|[?#])/i;

// 不许后端去抓的地址段。用 BlockList 而不是逐条 startsWith：IPv6 的写法太多，
// 只认 ::1 / fe80: / fc / fd 会漏掉 ::、IPv4-mapped、NAT64 与 6to4（S14-02）。
const BLOCKED = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  BLOCKED.addSubnet(address, prefix, "ipv4");
}
BLOCKED.addAddress("::", "ipv6");
BLOCKED.addAddress("::1", "ipv6");
for (const [address, prefix] of [
  ["64:ff9b::", 96], // NAT64
  ["2002::", 16], // 6to4
  ["fc00::", 7],
  ["fe80::", 10],
]) {
  BLOCKED.addSubnet(address, prefix, "ipv6");
}

// IPv4-mapped 的两种写法都要还原成 IPv4 再判，否则 ::ffff:127.0.0.1 会被当成普通 IPv6。
function mappedIpv4(ip) {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(ip);
  if (!hex) return "";
  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

function privateAddress(address) {
  const ip = String(address || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(ip)) return BLOCKED.check(ip, "ipv4");
  if (!net.isIPv6(ip)) return true;
  const mapped = mappedIpv4(ip);
  if (mapped) return privateAddress(mapped);
  return BLOCKED.check(ip, "ipv6");
}

export async function publicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  // IPv6 字面量在 hostname 里带方括号，不剥掉的话 net.isIP 一律返回 0，
  // 所有 IPv6 直链都会被当成域名去查 DNS，然后查不到被拒。
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return null;
  if (net.isIP(host)) return privateAddress(host) ? null : url;
  try {
    const records = await lookup(host, { all: true });
    if (!records.length || records.some((item) => privateAddress(item.address))) return null;
  } catch {
    return null;
  }
  return url;
}

export async function reachable(raw, hops = 0) {
  const url = await publicUrl(raw);
  if (!url || hops > HOP_LIMIT) {
    const error = new Error("bad_url");
    error.code = "bad_url";
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "user-agent": "Knot/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel?.();
      if (!next) {
        const error = new Error("bad_url");
        error.code = "bad_url";
        throw error;
      }
      return reachable(new URL(next, url).toString(), hops + 1);
    }
    await response.body?.cancel?.();
    if (!response.ok) {
      const error = new Error("bad_url");
      error.code = "bad_url";
      throw error;
    }
    return url.toString();
  } catch (error) {
    if (error.code === "bad_url") throw error;
    const wrapped = new Error("bad_url");
    wrapped.code = "bad_url";
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }
}

// 读响应体时设上限：先看 Content-Length，再边读边累计，够了就断开。
// 先 arrayBuffer() 再截断等于把整个响应（可能几百 MB）读进内存（S14-03）。
async function readBodyLimited(response) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > HTML_LIMIT) {
    await response.body?.cancel?.();
    return null;
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (total < HTML_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      const piece = value.length > HTML_LIMIT - total ? value.subarray(0, HTML_LIMIT - total) : value;
      chunks.push(piece);
      total += piece.length;
    }
  } finally {
    // 读到上限就不再看剩下的：断开连接，别让它继续往这里传。
    await reader.cancel?.().catch?.(() => {});
  }
  return Buffer.concat(chunks);
}

export async function readHtml(raw, hops = 0) {
  const url = await publicUrl(raw);
  if (!url || hops > HOP_LIMIT || VIDEO_FILE.test(url.pathname)) return { url, html: "" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "text/html", "user-agent": "Knot/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      await response.body?.cancel?.();
      if (!next) return { url, html: "" };
      return readHtml(new URL(next, url).toString(), hops + 1);
    }
    if (!response.ok) {
      await response.body?.cancel?.();
      return { url, html: "" };
    }
    const type = response.headers.get("content-type") || "";
    if (!type.includes("html") && !type.includes("text/")) {
      await response.body?.cancel?.();
      return { url, html: "" };
    }
    const bytes = await readBodyLimited(response);
    if (!bytes) return { url, html: "" };
    return { url, html: bytes.toString("utf8") };
  } catch {
    return { url, html: "" };
  } finally {
    clearTimeout(timer);
  }
}

// 把「落地页链接」解析成「可播直链」。拿不到就返回空，绝不因解析失败影响提交。
export async function resolveVideo(raw) {
  const url = await publicUrl(raw);
  if (!url) return "";
  if (VIDEO_FILE.test(url.pathname)) return url.toString();
  const page = await readHtml(url.toString());
  const direct = page.url ? previewVideo(page.html, page.url.toString()) : "";
  if (!direct) return "";
  const safe = await publicUrl(direct);
  return safe ? safe.toString() : "";
}
