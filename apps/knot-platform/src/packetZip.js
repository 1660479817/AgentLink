import fs from "node:fs";
import path from "node:path";
import { isAudioUpload, uploadName } from "./information.js";
import { storagePath } from "./uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const building = new Map();

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
  "audio/aac": ".aac",
  "application/pdf": ".pdf",
};

const LABEL = { image: "图片", audio: "音频", attachment: "附件" };

function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function kindOf(row) {
  const mime = String(row.mime || "");
  if (mime.startsWith("image/")) return "image";
  if (isAudioUpload({ mime, originalname: row.original_name })) return "audio";
  return "attachment";
}

function fallbackName(kind, mime) {
  const ext = MIME_EXT[String(mime || "").toLowerCase()] || "";
  if (kind === "image") return `image${ext}`;
  if (kind === "audio") return `audio${ext}`;
  return `file${ext}`;
}

function safeName(original, fallback) {
  const base = path.basename(String(original || "")).replace(/[\u0000-\u001f]/g, "").trim();
  return base || fallback;
}

function uniqueName(wanted, used) {
  const taken = (name) => name === "readme.txt" || used.has(name);
  if (!taken(wanted)) {
    used.add(wanted);
    return wanted;
  }
  const ext = path.extname(wanted);
  const stem = ext ? wanted.slice(0, -ext.length) : wanted;
  let n = 2;
  let next = `${stem}-${n}${ext}`;
  while (taken(next)) {
    n += 1;
    next = `${stem}-${n}${ext}`;
  }
  used.add(next);
  return next;
}

export function archiveSources(rows) {
  const groups = { image: [], audio: [], attachment: [] };
  for (const row of rows || []) groups[kindOf(row)].push(row);
  const used = new Set();
  const files = [];
  for (const kind of ["image", "audio", "attachment"]) {
    for (const row of groups[kind]) {
      files.push({
        label: LABEL[kind],
        name: uniqueName(safeName(uploadName(row.original_name), fallbackName(kind, row.mime)), used),
        storageName: row.storage_name,
      });
    }
  }
  return files;
}

function stamp(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}-${pick("month")}-${pick("day")} ${pick("hour")}:${pick("minute")}`;
}

function videoUrls(videos) {
  const list = Array.isArray(videos) ? videos : [];
  const urls = [];
  for (const item of list) {
    const url = typeof item === "string" ? item : item?.url;
    if (typeof url === "string" && url) urls.push(url);
  }
  return urls;
}

function linkLines(links) {
  const bag = links && typeof links === "object" ? links : {};
  const lines = [];
  for (const item of bag.images || []) if (item?.url) lines.push(`图片：${item.url}`);
  for (const item of bag.audio || []) if (item?.url) lines.push(`音频：${item.url}`);
  for (const item of bag.attachments || []) if (item?.url) lines.push(`附件：${item.url}`);
  return lines;
}

export function packetReadme({ category = "", price = 0, author = "", createdAt, videos = [], links = {}, files = [], body = "" }) {
  const lines = [];
  const kind = String(category || "").trim();
  if (kind) lines.push(`类别：${kind}`);
  lines.push(`报价：${Number(price) || 0}`);
  const name = String(author || "").trim();
  if (name) lines.push(`作者：${name}`);
  const when = stamp(createdAt);
  if (when) lines.push(`时间：${when}`);
  for (const url of videoUrls(videos)) lines.push(`视频：${url}`);
  lines.push(...linkLines(links));
  for (const file of files) lines.push(`${file.label}：${file.name}`);
  lines.push("");
  lines.push(String(body || "").trim());
  return `${lines.join("\n")}\n`;
}

export function packetDownloadName(body) {
  const line = String(body || "")
    .split(/\r?\n/)
    .map((part) => part.trim())
    .find(Boolean) || "";
  const cleaned = line.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 40);
  return `${cleaned || "packet"}.zip`;
}

export function attachmentDisposition(name) {
  const utf8 = encodeURIComponent(name);
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "") || "packet.zip";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = file.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(Buffer.concat([local, name, data]));
    centrals.push(Buffer.concat([central, name]));
    offset += local.length + name.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralDir, end]);
}

function zipReady(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(4);
    const read = fs.readSync(fd, head, 0, 4, 0);
    return read === 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function destPath(uploadDir, intelId) {
  if (!UUID.test(String(intelId || ""))) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  return path.join(path.resolve(uploadDir), "packets", `${intelId}.zip`);
}

async function writeZip(dest, render) {
  if (zipReady(dest)) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.partial`;
  try {
    const parts = await render();
    fs.writeFileSync(tmp, buildZip(parts));
    fs.renameSync(tmp, dest);
    return dest;
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export async function ensurePacketZip(uploadDir, intelId, readme, sources) {
  const dest = destPath(uploadDir, intelId);
  if (zipReady(dest)) return dest;
  const pending = building.get(dest);
  if (pending) return pending;
  let settle;
  let fail;
  const job = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  building.set(dest, job);
  writeZip(dest, async () => {
    const parts = [{ name: "readme.txt", data: Buffer.from(readme, "utf8") }];
    for (const source of sources) {
      const full = storagePath(uploadDir, path.basename(String(source.storageName || "")));
      let data;
      try {
        data = fs.readFileSync(full);
      } catch {
        const error = new Error("packet_unavailable");
        error.code = "packet_unavailable";
        throw error;
      }
      parts.push({ name: source.name, data });
    }
    return parts;
  }).then(settle, fail).finally(() => building.delete(dest));
  return job;
}
