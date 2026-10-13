import { lookup } from "node:dns/promises";
import net from "node:net";
import { knownPoster, previewImage } from "./information.js";

const VIDEO_FILE = /\.(mp4|webm|ogg|ogv|mov|m4v|mkv|avi)(?:$|[?#])/i;
const HOP_LIMIT = 3;
const HTML_LIMIT = 512 * 1024;

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

async function publicUrl(raw) {
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

export async function postersFor(urls) {
  const records = [];
  for (const url of urls) {
    const known = knownPoster(url);
    if (known) {
      records.push({ url, poster: known });
      continue;
    }
    const page = await readHtml(url);
    const poster = page.url ? previewImage(page.html, page.url.toString()) : "";
    const safe = poster ? await publicUrl(poster) : null;
    records.push(safe ? { url, poster: safe.toString() } : { url });
  }
  return records;
}
