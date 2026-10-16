import { createHash, randomUUID } from "node:crypto";
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
const ACTOR_LABEL = { person: "人", personal_agent: "Agent", platform: "平台" };
const HEAD_AVATAR = 88;
const HEAD_NAME = 40;
const HEAD_META = 28;
const META_KEY = /^[0-9a-f]{16}$/;

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

function textLine(value, x, baseline, size, fill, anchor = "start", weight = "") {
  const bold = weight ? ` font-weight="${weight}"` : "";
  return `<text x="${x}" y="${baseline}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" fill="${fill}"${bold}>${xml(value)}</text>`;
}

export function formatPosted(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${pick("year")}年${pick("month")}月${pick("day")}日 ${pick("hour")}:${pick("minute")}`;
}

function postedIso(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function shareHead(row) {
  const price = Number(row?.price);
  const actor = ACTOR_LABEL[row?.actor] ? row.actor : "";
  return {
    author: clean(row?.display_name) || "用户",
    posted: postedIso(row?.created_at),
    actor,
    category: clean(row?.category),
    price: Number.isFinite(price) ? Math.max(0, Math.trunc(price)) : 0,
  };
}

export function shareMetaKey(card) {
  const head = card?.head || {};
  const payload = ["2", head.author || "", head.posted || "", head.actor || "", head.category || "", String(head.price ?? 0)].join("\u0001");
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

async function inkWidth(text, size, weight = "") {
  const bold = weight ? ` font-weight="${weight}"` : "";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="${size + 40}">
  <text x="0" y="${size}" font-family="${FONT}" font-size="${size}" fill="#050505"${bold}>${xml(text)}</text>
</svg>`;
  const { info } = await sharp(Buffer.from(svg)).trim().png().toBuffer({ resolveWithObject: true });
  return info.width || 0;
}

function priceBox(label) {
  const size = 36;
  const coin = 34;
  const gap = 12;
  const padX = 22;
  const textW = Math.ceil(textWidth(label, size));
  return { size, coin, gap, padX, width: padX + coin + gap + textW + padX, height: 72, label };
}

function drawPrice(box, x, y) {
  const coinCx = x + box.padX + box.coin / 2;
  const coinCy = y + box.height / 2;
  const radius = box.coin / 2;
  const textX = x + box.padX + box.coin + box.gap;
  const baseline = coinCy + Math.round(box.size * 0.35);
  return `<rect x="${x}" y="${y}" width="${box.width}" height="${box.height}" rx="${box.height / 2}" fill="#F0F2F5"/><circle cx="${coinCx}" cy="${coinCy}" r="${radius}" fill="none" stroke="#0866FF" stroke-width="3"/><circle cx="${coinCx}" cy="${coinCy}" r="${(radius * 0.62).toFixed(2)}" fill="none" stroke="#0866FF" stroke-width="2.5"/><line x1="${coinCx}" y1="${(coinCy - radius * 0.42).toFixed(2)}" x2="${coinCx}" y2="${(coinCy + radius * 0.42).toFixed(2)}" stroke="#0866FF" stroke-width="2.5" stroke-linecap="round"/>${textLine(box.label, textX, baseline, box.size, "#050505", "start", "600")}`;
}

async function layoutHead(head) {
  const author = clean(head?.author) || "用户";
  const actor = ACTOR_LABEL[head?.actor] || "";
  const posted = formatPosted(head?.posted);
  const category = clean(head?.category);
  const price = Number.isFinite(Number(head?.price)) ? Math.max(0, Math.trunc(Number(head.price))) : 0;
  const box = priceBox(String(price));
  const textX = PAD + HEAD_AVATAR + 28;
  const textMax = Math.max(160, WIDTH - PAD - box.width - 24 - textX);
  const actorWidth = actor ? await inkWidth(actor, HEAD_META) : 0;
  const actorGap = actor ? 20 : 0;
  const name = fitLine(author, Math.max(80, textMax - actorWidth - actorGap), HEAD_NAME);
  const meta = fitLine([posted, category].filter(Boolean).join(" · "), textMax, HEAD_META);
  const textBlock = HEAD_NAME + (meta ? 14 + HEAD_META : 0);
  const block = Math.max(HEAD_AVATAR, textBlock);
  const top = 56;
  const avatarY = top + (block - HEAD_AVATAR) / 2;
  const blockTop = top + (block - textBlock) / 2;
  const nameY = blockTop + HEAD_NAME;
  const metaY = nameY + 14 + HEAD_META;
  const pillY = Math.round(top + block / 2 - box.height / 2);
  const letter = [...name.replace(/…$/, "")][0] || "用";
  const avatarCy = avatarY + HEAD_AVATAR / 2;
  const parts = [
    `<circle cx="${PAD + HEAD_AVATAR / 2}" cy="${avatarCy}" r="${HEAD_AVATAR / 2}" fill="#E4E6EB"/>`,
    `<text x="${PAD + HEAD_AVATAR / 2}" y="${avatarCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="40" font-weight="600" fill="#050505">${xml(letter)}</text>`,
    textLine(name, textX, nameY, HEAD_NAME, "#050505", "start", "600"),
  ];
  if (actor) parts.push(textLine(actor, textX + (await inkWidth(name, HEAD_NAME, "600")) + actorGap, nameY - 4, HEAD_META, "#65676B"));
  if (meta) parts.push(textLine(meta, textX, metaY, HEAD_META, "#65676B"));
  parts.push(drawPrice(box, WIDTH - PAD - box.width, pillY));
  const bottom = top + block + 28;
  parts.push(`<line x1="${PAD}" y1="${bottom}" x2="${WIDTH - PAD}" y2="${bottom}" stroke="#E4E6EB" stroke-width="2"/>`);
  return { svg: parts.join("\n  "), contentTop: bottom + GAP };
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
  const head = await layoutHead(content.head);
  const previewBox = await fittedPreview(content.preview, head.contentTop, PREVIEW_MAX);
  const imageHold = Boolean(content.image) && !previewBox;

  let y = head.contentTop;
  const parts = [head.svg];
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
    contentTop: head.contentTop,
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

export function sharePosterPath(uploadDir, intelId, contentHash, metaKey) {
  const id = String(intelId || "").toLowerCase();
  const hash = String(contentHash || "").toLowerCase();
  const meta = String(metaKey || "").toLowerCase();
  if (!ID.test(id) || !HASH.test(hash) || !META_KEY.test(meta)) {
    const error = new Error("not_found");
    error.code = "not_found";
    throw error;
  }
  return path.join(uploadDir, "shares", id, `${hash}-${meta}-poster.jpg`);
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
  const dest = sharePosterPath(uploadDir, card.id, card.contentHash, shareMetaKey(card));
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
    `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.kind, i.is_public, i.verdict,
            i.actor, i.category, i.price, i.created_at, u.display_name
     FROM intel i
     LEFT JOIN users u ON u.id = i.user_id
     WHERE i.id = $1 AND i.kind IN ('post', 'fastpost') AND i.is_public AND ${visibleVerdict("i.verdict")}`,
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
    head: shareHead(row),
    ...shareContent(row, files),
  };
}

export async function ensureSharePoster(pool, intelId, uploadDir = loadBootstrapConfig().uploadDir, render = renderSharePoster) {
  const card = await loadShareCard(pool, intelId, uploadDir);
  if (!card) return null;
  return storeSharePoster(uploadDir, card, render);
}
