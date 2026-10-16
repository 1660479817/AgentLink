import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { isAudioUpload, uploadName, visibleVerdict } from "./information.js";
import { ensureCardPreview } from "./preview.js";
import { loadBootstrapConfig } from "./config.js";

export const SHARE_PAGE = "https://knot.zenheart.net";
export const SHARE_HOST = "knot.zenheart.net";
export const SHARE_NAME = "Knot";
export const SHARE_LINE = "面向 AI 时代、服务于 Agent 的信息交换网。";

const WIDTH = 1080;
const PAD = 72;
const PANEL_PAD = 72;
const INNER = WIDTH - PAD * 2;
const GAP = 32;
const HOLD = 280;
const BODY_SIZE = 40;
const BODY_LEADING = 64;
const NAME_SIZE = 32;
const NAME_LEADING = 48;
const MAX_BODY_LINES = 24;
const PREVIEW_MAX = 900;
const QR_PIXEL = 10;
const QR_QUIET = 4;
const FONT = "Hiragino Sans GB, Heiti SC, PingFang SC, Songti SC, sans-serif";
const LABEL = { video: "视频", image: "图片" };

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const inflight = new Map();

function xml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[ch]));
}

function clean(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n/g, "\n")
    .trim();
}

function charUnits(ch) {
  const code = ch.codePointAt(0) || 0;
  if (code <= 0x02ff) return 0.56;
  return 1;
}

function textWidth(text, size) {
  let used = 0;
  for (const ch of text) used += charUnits(ch) * size;
  return used;
}

const STICKS = new Set([..."，。、！？：；,.!?;:）】》」』"]);

function ellipsize(line, width, size) {
  let value = line;
  while (value && textWidth(`${value}…`, size) > width) value = [...value].slice(0, -1).join("");
  return `${value}…`;
}

export function wrapText(text, width, size, maxLines = MAX_BODY_LINES) {
  const chars = [...clean(text)];
  const lines = [];
  let line = "";
  let used = 0;
  let cut = false;
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (ch === "\n") {
      lines.push(line);
      line = "";
      used = 0;
      if (lines.length === maxLines) {
        cut = index < chars.length - 1;
        break;
      }
      continue;
    }
    const next = charUnits(ch) * size;
    if (line && used + next > width) {
      if (STICKS.has(ch)) {
        line += ch;
        used += next;
        continue;
      }
      lines.push(line);
      line = "";
      used = 0;
      if (lines.length === maxLines) {
        cut = true;
        break;
      }
    }
    line += ch;
    used += next;
  }
  if (lines.length < maxLines) lines.push(line);
  else if (line) cut = true;
  if (cut && lines.length) lines[lines.length - 1] = ellipsize(lines[lines.length - 1], width, size);
  return lines.length ? lines : [""];
}

function linkName(list) {
  if (!Array.isArray(list)) return "";
  for (const item of list) {
    const name = clean(item?.name);
    if (name) return name;
  }
  return "";
}

function hasVideo(videos) {
  return (Array.isArray(videos) ? videos : []).some((item) => {
    const url = typeof item === "string" ? item : item?.url;
    return typeof url === "string" && url.trim();
  });
}

function fileKind(row) {
  const mime = String(row.mime || "");
  const name = uploadName(row.original_name);
  if (mime.startsWith("image/")) return { kind: "image", name };
  if (isAudioUpload({ mime, originalname: row.original_name })) return { kind: "audio", name };
  return { kind: "file", name };
}

export function shareContent(row, files = []) {
  const links = row?.links && typeof row.links === "object" && !Array.isArray(row.links) ? row.links : {};
  const stored = files.map(fileKind);
  const audioName = stored.find((file) => file.kind === "audio")?.name || linkName(links.audio);
  const fileName = stored.find((file) => file.kind === "file")?.name || linkName(links.attachments);
  const image = stored.some((file) => file.kind === "image") || linkName(links.images) !== "" || (Array.isArray(links.images) && links.images.some((item) => item?.url));
  return {
    body: clean(row?.body),
    video: hasVideo(row?.videos),
    audioName: clean(audioName),
    fileName: clean(fileName),
    image,
  };
}

function qrRects() {
  const qr = QRCode.create(SHARE_PAGE, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const parts = [];
  let dark = 0;
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      if (!qr.modules.get(row, col)) continue;
      dark += 1;
      const left = (col + QR_QUIET) * QR_PIXEL;
      const top = (row + QR_QUIET) * QR_PIXEL;
      parts.push(`<rect x="${left}" y="${top}" width="${QR_PIXEL}" height="${QR_PIXEL}" fill="#050505"/>`);
    }
  }
  return { svg: parts.join(""), size: (n + QR_QUIET * 2) * QR_PIXEL, dark };
}

function hold(x, y, label, video) {
  const cx = x + INNER / 2 - (video ? 36 : 0);
  const cy = y + HOLD / 2;
  const play = video
    ? `<circle cx="${cx}" cy="${cy}" r="26" fill="none" stroke="#65676B" stroke-width="3"/><path d="M${cx - 8} ${cy - 12} L${cx + 14} ${cy} L${cx - 8} ${cy + 12} Z" fill="#65676B"/>`
    : "";
  const textX = video ? cx + 48 : x + INNER / 2;
  const anchor = video ? "start" : "middle";
  return `<rect x="${x}" y="${y}" width="${INNER}" height="${HOLD}" rx="12" fill="#F0F2F5"/>${play}<text x="${textX}" y="${cy + 10}" text-anchor="${anchor}" font-family="${FONT}" font-size="28" fill="#050505">${xml(label)}</text>`;
}

function textLine(value, x, baseline, size, fill, anchor = "start") {
  return `<text x="${x}" y="${baseline}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}">${xml(value)}</text>`;
}

function fitLine(text, width, size) {
  return textWidth(text, size) > width ? ellipsize(text, width, size) : text;
}

async function fittedPreview(preview, y, maxHeight) {
  if (!preview) return null;
  try {
    const meta = await sharp(preview).rotate().metadata();
    const srcW = meta.width || 0;
    const srcH = meta.height || 0;
    if (!srcW || !srcH) return null;
    let height = Math.round((srcH / srcW) * INNER);
    if (height > maxHeight) height = maxHeight;
    if (height < 1) return null;
    return { x: PAD, y, width: INNER, height };
  } catch {
    return null;
  }
}

function posterPr() {
  const qr = qrRects();
  const nameSize = 56;
  const lineSize = 32;
  const hostSize = 26;
  const lines = wrapText(SHARE_LINE, INNER, lineSize, 3).filter((line) => line);
  const textHeight = nameSize + 16 + lines.length * (lineSize + 10) + 12 + hostSize;
  const group = textHeight + 48 + qr.size;
  return { qr, lines, nameSize, lineSize, hostSize, textHeight, group, height: group + PANEL_PAD * 2 };
}

export async function buildSharePoster(content) {
  const body = clean(content.body);
  const audioName = clean(content.audioName);
  const fileName = clean(content.fileName);
  const texts = [];
  if (body) {
    for (const line of wrapText(body, INNER, BODY_SIZE, MAX_BODY_LINES)) {
      texts.push({ text: line, size: BODY_SIZE, leading: BODY_LEADING, fill: "#050505" });
    }
    if (audioName) texts.push({ text: fitLine(audioName, INNER, NAME_SIZE), size: NAME_SIZE, leading: NAME_LEADING, fill: "#65676B" });
    if (fileName) texts.push({ text: fitLine(fileName, INNER, NAME_SIZE), size: NAME_SIZE, leading: NAME_LEADING, fill: "#65676B" });
  } else {
    const stand = audioName || fileName;
    if (stand) texts.push({ text: fitLine(stand, INNER, BODY_SIZE), size: BODY_SIZE, leading: BODY_LEADING, fill: "#050505" });
  }

  const pr = posterPr();
  const previewBox = await fittedPreview(content.preview, PAD, PREVIEW_MAX);
  const imageHold = Boolean(content.image) && !previewBox;

  let y = PAD;
  const parts = [];
  let placedPreview = previewBox;
  if (placedPreview) {
    placedPreview = { ...placedPreview, y };
    y += placedPreview.height + GAP;
  }
  let videoY = 0;
  if (content.video) {
    videoY = y;
    parts.push(hold(PAD, y, LABEL.video, true));
    y += HOLD + GAP;
  }
  let imageY = 0;
  if (imageHold) {
    imageY = y;
    parts.push(hold(PAD, y, LABEL.image, false));
    y += HOLD + GAP;
  }
  for (const line of texts) {
    if (!line.text) {
      y += line.leading;
      continue;
    }
    parts.push(textLine(line.text, PAD, y + line.size, line.size, line.fill));
    y += line.leading;
  }
  const contentBottom = y;
  const footerTop = contentBottom + GAP;
  const height = footerTop + pr.height;
  const zoneHeight = pr.height;
  let cursor = footerTop + Math.round((zoneHeight - pr.group) / 2);
  const footer = [];
  cursor += pr.nameSize;
  footer.push(textLine(SHARE_NAME, WIDTH / 2, cursor, pr.nameSize, "#0866FF", "middle"));
  cursor += 16;
  for (const line of pr.lines) {
    cursor += pr.lineSize;
    footer.push(textLine(line, WIDTH / 2, cursor, pr.lineSize, "#050505", "middle"));
    cursor += 10;
  }
  cursor += 12;
  cursor += pr.hostSize;
  const prTextBottom = cursor;
  footer.push(textLine(SHARE_HOST, WIDTH / 2, cursor, pr.hostSize, "#1C1E21", "middle"));
  const qrY = prTextBottom + 48;
  const qrX = Math.round((WIDTH - pr.qr.size) / 2);
  const plate = 24;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}">
  <rect width="${WIDTH}" height="${height}" fill="#FFFFFF"/>
  ${parts.join("\n  ")}
  <rect x="0" y="${footerTop}" width="${WIDTH}" height="${zoneHeight}" fill="#F0F2F5"/>
  ${footer.join("\n  ")}
  <rect x="${qrX - plate}" y="${qrY - plate}" width="${pr.qr.size + plate * 2}" height="${pr.qr.size + plate * 2}" rx="20" fill="#FFFFFF"/>
  <g transform="translate(${qrX} ${qrY})">${pr.qr.svg}</g>
</svg>`;
  return {
    width: WIDTH,
    height,
    svg,
    previewBox: placedPreview,
    qr: { x: qrX, y: qrY, size: pr.qr.size, dark: pr.qr.dark, pixel: QR_PIXEL },
    footerTop,
    contentBottom,
    prTextBottom,
    videoY,
    imageY,
  };
}

export async function renderSharePoster(content) {
  const layout = await buildSharePoster(content);
  if (!layout.previewBox) return sharp(Buffer.from(layout.svg)).jpeg({ quality: 90 }).toBuffer();
  const box = layout.previewBox;
  const layer = await sharp(content.preview).rotate().resize(box.width, box.height, { fit: "cover" }).png().toBuffer();
  return sharp(Buffer.from(layout.svg))
    .composite([{ input: layer, left: box.x, top: box.y }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

export function sharePosterPath(uploadDir, intelId, contentHash) {
  const id = String(intelId || "").toLowerCase();
  const hash = String(contentHash || "").toLowerCase();
  if (!ID.test(id) || !HASH.test(hash)) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  return path.join(uploadDir, "shares", id, `${hash}-poster.jpg`);
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function dropStale(dest) {
  const dir = path.dirname(dest);
  const keep = path.basename(dest);
  let names = [];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name !== keep && name.endsWith(".jpg"))
      .map((name) => rm(path.join(dir, name), { force: true }))
  );
}

async function writeOnce(dest, card, render) {
  if (await fileExists(dest)) return dest;
  const jpeg = await render(card);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${randomUUID()}.tmp`;
  try {
    await writeFile(tmp, jpeg);
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  await dropStale(dest);
  return dest;
}

export function storeSharePoster(uploadDir, card, render = renderSharePoster) {
  const dest = sharePosterPath(uploadDir, card.id, card.contentHash);
  const pending = inflight.get(dest);
  if (pending) return pending;
  const job = writeOnce(dest, card, render);
  inflight.set(dest, job);
  job.finally(() => {
    if (inflight.get(dest) === job) inflight.delete(dest);
  });
  return job;
}

function shareable(row) {
  if (!row) return false;
  if (row.kind !== "post" && row.kind !== "fastpost") return false;
  if (row.is_public === false) return false;
  if (row.verdict !== "pending" && row.verdict !== "passed") return false;
  return ID.test(String(row.id || "")) && HASH.test(String(row.content_hash || ""));
}

export async function loadShareCard(pool, intelId, uploadDir) {
  if (!ID.test(String(intelId || ""))) return null;
  const { rows } = await pool.query(
    `SELECT id, body, videos, links, content_hash, kind, is_public, verdict
     FROM intel
     WHERE id = $1 AND kind IN ('post', 'fastpost') AND is_public AND ${visibleVerdict("verdict")}`,
    [intelId]
  );
  const row = rows[0];
  if (!shareable(row)) return null;
  const { rows: files } = await pool.query(
    `SELECT u.mime, u.original_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [row.id]
  );
  let preview = "";
  try {
    preview = (await ensureCardPreview(pool, row.id, uploadDir)) || "";
  } catch {
    preview = "";
  }
  if (preview && !(await fileExists(preview))) preview = "";
  return {
    id: String(row.id).toLowerCase(),
    contentHash: String(row.content_hash).toLowerCase(),
    preview,
    ...shareContent(row, files),
  };
}

export async function ensureSharePoster(pool, intelId, uploadDir = loadBootstrapConfig().uploadDir, render = renderSharePoster) {
  const card = await loadShareCard(pool, intelId, uploadDir);
  if (!card) return null;
  return storeSharePoster(uploadDir, card, render);
}
