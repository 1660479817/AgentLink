import { lookup } from "node:dns/promises";
import net from "node:net";
import { previewVideo } from "./information.js";

const HOP_LIMIT = 3;
const HTML_LIMIT = 512 * 1024;
const VIDEO_FILE = /\.(mp4|webm|ogg|ogv|mov|m4v)(?:$|[?#])/i;

function privateAddress(address) {
  const ip = String(address || "").toLowerCase();
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (!net.isIPv6(ip)) return true;
  return ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd");
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
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
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

async function readHtml(raw, hops = 0) {
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
      if (!next) return { url, html: "" };
      return readHtml(new URL(next, url).toString(), hops + 1);
    }
    if (!response.ok) return { url, html: "" };
    const type = response.headers.get("content-type") || "";
    if (!type.includes("html") && !type.includes("text/")) return { url, html: "" };
    const bytes = Buffer.from(await response.arrayBuffer()).subarray(0, HTML_LIMIT);
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
