import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { keyEntry, resolve } from "@knot/config";
import { isMarkdown, toRuns } from "@knot/markdown";
import { isAudioUpload, uploadName, visibleVerdict } from "./information.js";
import { loadBootstrapConfig } from "./config.js";
import { pickLocale, profileFilePath, readProfileSync } from "./profile.js";
import { derivedDir, readableBlobPath } from "./storage.js";
import { defaultAvatarIndex } from "./avatars.js";

// 样例值也从 schema 取，不再在这里写第二份。
// 站点名与标语来自站点档案 sites/<站点>/profile.json，按这次请求的语种取。
const SCHEMA_CTX = { root: "", deployRoot: "", home: "" };
const schemaDefault = (key) => resolve(keyEntry(key), {}, SCHEMA_CTX);

export const SHARE_PAGE = schemaDefault("KNOT_PUBLIC_ORIGIN");
export const SHARE_HOST = new URL(SHARE_PAGE).host;
export const SHARE_NAME = "Knot";
export const SHARE_LINE = "面向 AI 时代、服务于 Agent 的信息交换网。";

export function shareSite(env = process.env) {
  const config = loadBootstrapConfig(env);
  // 没有部署配置时回落到 schema 里的默认地址，测试和本地开发不受影响。
  const page = config.publicWebOrigin.replace(/\/$/, "");
  let host = SHARE_HOST;
  try {
    host = new URL(page).host || SHARE_HOST;
  } catch {
    /* 保留默认主机名 */
  }
  // 落款取自站点档案（自述区）；没填时用兜底文案，图不会缺字。
  const { profile } = readProfileSync(profileFilePath(env, config.agentEnvDir));
  return {
    page,
    host,
    name: pickLocale(profile?.name, "zh-CN") || SHARE_NAME,
    line: pickLocale(profile?.intro?.oneLine, "zh-CN") || SHARE_LINE,
  };
}

const WIDTH = 1080;
const PAD = 72;
const PANEL_PAD = 72;
const INNER = WIDTH - PAD * 2;
// sharp 读 SVG 的单边上限是 32767px。留出余量，并让一张长图仍能发进聊天工具。
export const MAX_HEIGHT = 24576;
// 预览图最高占 5 倍内容宽，超出的竖图按顶部裁切，不让一张图吃掉整张海报。
export const MAX_PREVIEW_HEIGHT = INNER * 5;
const GAP = 32;
const HOLD = 280;
const BODY_SIZE = 40;
const BODY_LEADING = 64;
const NAME_SIZE = 32;
const NAME_LEADING = 48;
const QR_PIXEL = 10;
const QR_QUIET = 4;
const FONT = "Hiragino Sans GB, Heiti SC, PingFang SC, Songti SC, sans-serif";
const MONO = "Menlo, Consolas, Monaco, monospace";
const H1_SIZE = 52;
const H1_LEADING = 74;
const H2_SIZE = 44;
const H2_LEADING = 62;
const H3_SIZE = 40;
const H3_LEADING = 58;
const CODE_SIZE = 30;
const CODE_LEADING = 46;
const LABEL = { video: "视频", image: "图片" };
const ACTOR_LABEL = { person: "人", personal_agent: "Agent", platform: "平台" };
const HEAD_AVATAR = 88;
const HEAD_NAME = 40;
const HEAD_META = 28;
const META_KEY = /^[0-9a-f]{16}$/;
const AVATAR_DIR = path.resolve(import.meta.dirname, "../../web/public/avatars");

function defaultAvatarPath(index) {
  return path.join(AVATAR_DIR, `${String(index + 1).padStart(2, "0")}.svg`);
}

export function shareUrl(intelId, site = shareSite()) {
  const base = site.page.replace(/\/$/, "");
  return intelId ? `${base}/discover?post=${intelId}` : base;
}

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

export function wrapText(text, width, size, maxLines = Infinity) {
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

function compressSegments(chars) {
  const segments = [];
  let current = null;
  for (const ch of chars) {
    const key = `${ch.bold ? 1 : 0}${ch.italic ? 1 : 0}${ch.code ? 1 : 0}${ch.link || ""}`;
    if (!current || current.key !== key) {
      current = { key, text: ch.ch, bold: ch.bold, italic: ch.italic, code: ch.code, link: ch.link };
      segments.push(current);
    } else {
      current.text += ch.ch;
    }
  }
  for (const segment of segments) delete segment.key;
  return segments;
}

function wrapInline(segments, width, size) {
  const chars = [];
  for (const segment of segments) {
    for (const ch of segment.text) chars.push({ ch, bold: segment.bold, italic: segment.italic, code: segment.code, link: segment.link });
  }
  const lines = [];
  let line = [];
  let used = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    const next = charUnits(ch.ch) * size;
    if (line.length && used + next > width) {
      lines.push(line);
      line = [];
      used = 0;
    }
    line.push(ch);
    used += next;
  }
  if (line.length) lines.push(line);
  if (!lines.length) return [[{ text: "", bold: false, italic: false, code: false, link: null }]];
  return lines.map(compressSegments);
}

// 海报的文字行由共享解析器给出，这里只负责字号、缩进和省略号。
export function markdownTexts(body, width = INNER, maxLines = Infinity) {
  const items = [];
  const add = (item) => {
    if (items.length >= maxLines) return false;
    items.push(item);
    return true;
  };
  const ellipsizeLast = () => {
    const last = items[items.length - 1];
    const segments = last?.segments;
    if (!segments || !segments.length) return;
    const tail = segments[segments.length - 1];
    tail.text = `${tail.text.replace(/…$/, "")}…`;
  };

  for (const run of toRuns(clean(body))) {
    if (items.length >= maxLines) break;

    if (run.type === "rule") {
      add({ rule: true, leading: GAP });
      continue;
    }

    if (run.type === "code") {
      for (const raw of run.lines) {
        const code = raw.replace(/\t/g, "  ");
        const item = {
          segments: [{ text: code || " ", bold: false, italic: false, code: true, link: null }],
          size: CODE_SIZE,
          leading: CODE_LEADING,
          fill: "#050505",
          code: true,
        };
        if (!add(item)) break;
      }
      continue;
    }

    if (run.type === "heading") {
      const level = Math.max(1, Math.min(3, run.level));
      const size = level === 1 ? H1_SIZE : level === 2 ? H2_SIZE : H3_SIZE;
      const leading = level === 1 ? H1_LEADING : level === 2 ? H2_LEADING : H3_LEADING;
      for (const line of wrapInline(run.segments, width, size)) {
        if (!add({ segments: line, size, leading, fill: "#050505", weight: "600" })) break;
      }
      continue;
    }

    const indent = run.indent || 0;
    const fill = run.quote ? "#65676B" : "#050505";
    const lines = wrapInline(run.segments, Math.max(1, width - indent), BODY_SIZE);
    for (let index = 0; index < lines.length; index += 1) {
      const item = { segments: lines[index], size: BODY_SIZE, leading: BODY_LEADING, fill, indent };
      if (index === 0 && run.prefix) item.prefix = run.prefix;
      if (run.quote) item.quote = true;
      if (!add(item)) break;
    }
  }

  if (items.length >= maxLines) ellipsizeLast();
  return items;
}

function renderRichLine(line, x, baseline) {
  if (!line.segments) {
    const weight = line.weight ? ` font-weight="${line.weight}"` : "";
    return `<text x="${x}" y="${baseline}" font-family="${FONT}" font-size="${line.size}" fill="${line.fill || "#050505"}"${weight}>${xml(line.text)}</text>`;
  }
  const weight = line.weight ? ` font-weight="${line.weight}"` : "";
  const spans = line.segments
    .map((segment) => {
      let attrs = "";
      if (segment.bold || line.weight) attrs += ' font-weight="600"';
      if (segment.italic) attrs += ' font-style="italic"';
      if (segment.code) attrs += ` font-family="${MONO}"`;
      const fill = segment.link ? "#0866FF" : segment.code ? "#65676B" : line.fill || "#050505";
      return `<tspan${attrs} fill="${fill}">${xml(segment.text)}</tspan>`;
    })
    .join("");
  return `<text x="${x}" y="${baseline}" font-family="${FONT}" font-size="${line.size}" fill="${line.fill || "#050505"}"${weight}>${spans}</text>`;
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
  const image = stored.some((file) => file.kind === "image");
  return {
    body: clean(row?.body),
    video: hasVideo(row?.videos),
    audioName: clean(audioName),
    fileName: clean(fileName),
    image,
  };
}

function qrRects(url) {
  const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
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
  const site = shareSite();
  const payload = ["3", site.page, site.name, site.line, head.author || "", head.posted || "", head.actor || "", head.category || "", String(head.price ?? 0), head.avatarKey || ""].join("\u0001");
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

const widthCache = new Map();
async function measureWidth(text, size, weight = "") {
  const key = `${size}\u0000${weight}\u0000${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;
  const value = await inkWidth(text, size, weight);
  widthCache.set(key, value);
  return value;
}

async function priceBox(label) {
  const size = 36;
  const coin = 34;
  const gap = 12;
  const padX = 22;
  const textW = Math.ceil(await measureWidth(label, size, "600"));
  return { size, coin, gap, padX, width: padX + coin + gap + textW + padX, height: 72, label };
}

// 0 元不画角标：和卡片一致，免费帖的价格没有信息量。
export function priceLabel(price) {
  const value = Number(price);
  if (!Number.isFinite(value)) return "";
  const points = Math.trunc(value);
  return points > 0 ? String(points) : "";
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
  const label = priceLabel(head?.price);
  const box = label ? await priceBox(label) : null;
  const textX = PAD + HEAD_AVATAR + 28;
  const textMax = Math.max(160, WIDTH - PAD - (box ? box.width + 24 : 0) - textX);
  const actorWidth = actor ? await measureWidth(actor, HEAD_META) : 0;
  const actorGap = actor ? 20 : 0;
  const name = await fitLine(author, Math.max(80, textMax - actorWidth - actorGap), HEAD_NAME, "600");
  const meta = await fitLine([posted, category].filter(Boolean).join(" · "), textMax, HEAD_META);
  const textBlock = HEAD_NAME + (meta ? 14 + HEAD_META : 0);
  const block = Math.max(HEAD_AVATAR, textBlock);
  const top = 56;
  const avatarY = top + (block - HEAD_AVATAR) / 2;
  const blockTop = top + (block - textBlock) / 2;
  const nameY = blockTop + HEAD_NAME;
  const metaY = nameY + 14 + HEAD_META;
  const pillY = box ? Math.round(top + block / 2 - box.height / 2) : 0;
  const letter = [...name.replace(/…$/, "")][0] || "用";
  const avatarCy = avatarY + HEAD_AVATAR / 2;
  const parts = [
    `<circle cx="${PAD + HEAD_AVATAR / 2}" cy="${avatarCy}" r="${HEAD_AVATAR / 2}" fill="#E4E6EB"/>`,
    `<text x="${PAD + HEAD_AVATAR / 2}" y="${avatarCy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="40" font-weight="600" fill="#050505">${xml(letter)}</text>`,
    textLine(name, textX, nameY, HEAD_NAME, "#050505", "start", "600"),
  ];
  if (actor) parts.push(textLine(actor, textX + (await measureWidth(name, HEAD_NAME, "600")) + actorGap, nameY - 4, HEAD_META, "#65676B"));
  if (meta) parts.push(textLine(meta, textX, metaY, HEAD_META, "#65676B"));
  if (box) parts.push(drawPrice(box, WIDTH - PAD - box.width, pillY));
  const bottom = top + block + 28;
  parts.push(`<line x1="${PAD}" y1="${bottom}" x2="${WIDTH - PAD}" y2="${bottom}" stroke="#E4E6EB" stroke-width="2"/>`);
  return { svg: parts.join("\n  "), contentTop: bottom + GAP, avatarBox: { x: PAD, y: avatarY, size: HEAD_AVATAR } };
}

async function fitLine(text, width, size, weight = "") {
  const value = clean(text);
  if (!value) return value;
  if ((await measureWidth(value, size, weight)) <= width) return value;
  let trimmed = value;
  while (trimmed && (await measureWidth(`${trimmed}…`, size, weight)) > width) {
    trimmed = [...trimmed].slice(0, -1).join("");
  }
  return `${trimmed}…`;
}

async function fittedPreview(preview, y) {
  if (!preview) return null;
  try {
    const meta = await sharp(preview).rotate().metadata();
    const srcW = meta.width || 0;
    const srcH = meta.height || 0;
    if (!srcW || !srcH) return null;
    const natural = Math.round((srcH / srcW) * INNER);
    if (natural < 1) return null;
    return { x: PAD, y, width: INNER, height: Math.min(natural, MAX_PREVIEW_HEIGHT) };
  } catch {
    return null;
  }
}

// 高度到顶时，把最后一段有字的正文收尾成省略号。
function ellipsizeLine(line) {
  if (line.rule) return false;
  if (line.segments?.length) {
    const tail = line.segments[line.segments.length - 1];
    if (!tail.text) return false;
    tail.text = `${tail.text.replace(/…$/, "")}…`;
    return true;
  }
  if (typeof line.text === "string" && line.text) {
    line.text = `${line.text.replace(/…$/, "")}…`;
    return true;
  }
  return false;
}

// 只保留放得进 room 的行。放不下的部分不画，最后一句话用省略号收住。
function fitTexts(texts, room) {
  const kept = [];
  let used = 0;
  for (const line of texts) {
    if (used + line.leading > room) {
      for (let index = kept.length - 1; index >= 0; index -= 1) {
        if (ellipsizeLine(kept[index])) break;
      }
      return kept;
    }
    kept.push(line);
    used += line.leading;
  }
  return kept;
}

function posterPr(content, site) {
  const qr = qrRects(shareUrl(content?.id, site));
  const nameSize = 56;
  const lineSize = 32;
  const hostSize = 26;
  const lines = wrapText(site.line, INNER, lineSize, 3).filter((line) => line);
  const textHeight = nameSize + 16 + lines.length * (lineSize + 10) + 12 + hostSize;
  const group = textHeight + 48 + qr.size;
  return { qr, lines, nameSize, lineSize, hostSize, textHeight, group, height: group + PANEL_PAD * 2 };
}

export async function buildSharePoster(content, site = shareSite()) {
  const body = clean(content.body);
  const audioName = clean(content.audioName);
  const fileName = clean(content.fileName);
  const texts = [];
  if (body) {
    if (isMarkdown(body)) {
      texts.push(...markdownTexts(body, INNER));
    } else {
      for (const line of wrapText(body, INNER, BODY_SIZE)) {
        texts.push({ text: line, size: BODY_SIZE, leading: BODY_LEADING, fill: "#050505" });
      }
    }
    if (audioName) texts.push({ text: await fitLine(audioName, INNER, NAME_SIZE), size: NAME_SIZE, leading: NAME_LEADING, fill: "#65676B" });
    if (fileName) texts.push({ text: await fitLine(fileName, INNER, NAME_SIZE), size: NAME_SIZE, leading: NAME_LEADING, fill: "#65676B" });
  } else {
    const stand = audioName || fileName;
    if (stand) texts.push({ text: await fitLine(stand, INNER, BODY_SIZE), size: BODY_SIZE, leading: BODY_LEADING, fill: "#050505" });
  }

  const pr = posterPr(content, site);
  const head = await layoutHead(content.head);
  const previewBox = await fittedPreview(content.preview, head.contentTop);
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
  // 正文按剩余高度收口，保证整张图不超过 MAX_HEIGHT（sharp 读 SVG 有单边上限）。
  const fitted = fitTexts(texts, MAX_HEIGHT - GAP - pr.height - y);
  for (const line of fitted) {
    if (line.rule) {
      parts.push(`<line x1="${PAD}" y1="${y + Math.round(line.leading / 2)}" x2="${WIDTH - PAD}" y2="${y + Math.round(line.leading / 2)}" stroke="#E4E6EB" stroke-width="2"/>`);
      y += line.leading;
      continue;
    }
    const hasText = Boolean(line.text) || Boolean(line.segments && line.segments.some((segment) => segment.text));
    if (!hasText) {
      y += line.leading;
      continue;
    }
    if (line.quote) parts.push(`<rect x="${PAD}" y="${y + 4}" width="4" height="${line.size + 6}" rx="2" fill="#E4E6EB"/>`);
    if (line.code) parts.push(`<rect x="${PAD - 10}" y="${y + 2}" width="${INNER + 20}" height="${line.leading - 4}" rx="6" fill="#F0F2F5"/>`);
    if (line.prefix) parts.push(textLine(line.prefix, PAD + 8, y + line.size, line.size, line.fill, "start", "600"));
    const textX = line.indent ? PAD + line.indent : PAD;
    parts.push(renderRichLine(line, textX, y + line.size));
    y += line.leading;
  }
  const contentBottom = y;
  const footerTop = contentBottom + GAP;
  const height = footerTop + pr.height;
  const zoneHeight = pr.height;
  let cursor = footerTop + Math.round((zoneHeight - pr.group) / 2);
  const footer = [];
  cursor += pr.nameSize;
  footer.push(textLine(site.name, WIDTH / 2, cursor, pr.nameSize, "#0866FF", "middle"));
  cursor += 16;
  for (const line of pr.lines) {
    cursor += pr.lineSize;
    footer.push(textLine(line, WIDTH / 2, cursor, pr.lineSize, "#050505", "middle"));
    cursor += 10;
  }
  cursor += 12;
  cursor += pr.hostSize;
  const prTextBottom = cursor;
  footer.push(textLine(site.host, WIDTH / 2, cursor, pr.hostSize, "#1C1E21", "middle"));
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
    avatarBox: head.avatarBox,
    qr: { x: qrX, y: qrY, size: pr.qr.size, dark: pr.qr.dark, pixel: QR_PIXEL },
    footerTop,
    contentTop: head.contentTop,
    contentBottom,
    prTextBottom,
    videoY,
    imageY,
  };
}

async function roundAvatar(input, size) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#FFFFFF"/></svg>`
  );
  return sharp(input)
    .rotate()
    .resize(size, size, { fit: "cover" })
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

export async function renderSharePoster(content) {
  const layout = await buildSharePoster(content);
  const composites = [];
  if (layout.previewBox && content.preview) {
    const box = layout.previewBox;
    // 只有超长竖图被 MAX_PREVIEW_HEIGHT 截过，此时保留图片顶部。
    const layer = await sharp(content.preview)
      .rotate()
      .resize(box.width, box.height, { fit: "cover", position: "top" })
      .png()
      .toBuffer();
    composites.push({ input: layer, left: box.x, top: box.y });
  }
  if (layout.avatarBox && content.avatarPath) {
    try {
      const layer = await roundAvatar(content.avatarPath, layout.avatarBox.size);
      composites.push({ input: layer, left: layout.avatarBox.x, top: layout.avatarBox.y });
    } catch {
      /* keep the letter fallback already drawn in the SVG */
    }
  }
  let image = sharp(Buffer.from(layout.svg));
  if (composites.length) image = image.composite(composites);
  return image.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
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
  return path.join(derivedDir(uploadDir, "shares"), id, `${hash}-${meta}-poster.jpg`);
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
  // 这里必须接住 job 的拒绝：finally 派生出的 promise 没人等，Node 会当成未处理拒绝退出进程。
  job
    .catch(() => {})
    .finally(() => {
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
  // 分享图跟着帖子走，不跟着版本走：拿到旧地址也画最新那一版。
  const { rows } = await pool.query(
    `SELECT i.id, i.body, i.videos, i.links, i.content_hash, i.kind, i.is_public, i.verdict,
            i.actor, i.category, i.price, i.created_at, i.user_id, u.display_name, u.avatar_upload_id
     FROM intel i
     LEFT JOIN users u ON u.id = i.user_id
     WHERE COALESCE(i.origin_id, i.id) = (SELECT COALESCE(origin_id, id) FROM intel WHERE id = $1::uuid)
       AND i.kind IN ('post', 'fastpost') AND i.is_public AND ${visibleVerdict("i.verdict")}
     ORDER BY i.version DESC
     LIMIT 1`,
    [intelId]
  );
  const row = rows[0];
  if (!shareable(row)) return null;
  const { rows: files } = await pool.query(
    `SELECT u.mime, u.original_name, u.storage_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1
     ORDER BY f.sort_order ASC, f.upload_id ASC`,
    [row.id]
  );
  const image = files.find((file) => String(file.mime || "").startsWith("image/"));
  let preview = image ? readableBlobPath(uploadDir, image.storage_name) : "";
  if (preview && !(await fileExists(preview))) preview = "";
  const head = shareHead(row);
  let avatarPath = "";
  let avatarKey = "";
  if (row.avatar_upload_id) {
    const { rows: avatars } = await pool.query(
      `SELECT storage_name FROM uploads WHERE id = $1`,
      [row.avatar_upload_id]
    );
    const storage = avatars[0]?.storage_name;
    if (storage) {
      avatarPath = readableBlobPath(uploadDir, storage);
      avatarKey = `upload:${String(row.avatar_upload_id).toLowerCase()}`;
    }
  } else if (row.user_id) {
    const index = defaultAvatarIndex(row.user_id);
    avatarPath = defaultAvatarPath(index);
    avatarKey = `default:${index}`;
  }
  head.avatarKey = avatarKey;
  return {
    id: String(row.id).toLowerCase(),
    contentHash: String(row.content_hash).toLowerCase(),
    preview,
    avatarPath,
    head,
    ...shareContent(row, files),
  };
}

export async function ensureSharePoster(pool, intelId, uploadDir = loadBootstrapConfig().uploadDir, render = renderSharePoster) {
  const card = await loadShareCard(pool, intelId, uploadDir);
  if (!card) return null;
  return storeSharePoster(uploadDir, card, render);
}
