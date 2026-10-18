import { serviceFee, economyConfig } from "./points.js";

export function payeeFor(kind) {
  return kind === "wish" ? "platform" : "author";
}

function recordText(detail, key) {
  if (!detail || typeof detail !== "object") return "";
  return typeof detail[key] === "string" ? detail[key].trim() : "";
}

function recordTopics(detail) {
  if (!detail || typeof detail !== "object" || !Array.isArray(detail.topics)) return [];
  const topics = [];
  for (const item of detail.topics) {
    const topic = String(item).trim();
    if (topic && !topics.includes(topic)) topics.push(topic);
  }
  return topics;
}

function bag(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function externalOf(item) {
  if (!item || typeof item.url !== "string" || !item.url) return null;
  return {
    url: item.url,
    name: item.name || "",
    mime: item.mime || "",
    stored: false,
  };
}

function storedOf(file) {
  const link = {
    name: file.name || "",
    mime: file.mime || "",
    stored: true,
  };
  const direct = Boolean(file.image) || (Boolean(file.audio) && !file.image);
  if (direct && file.url) link.url = file.url;
  return link;
}

function attachmentBytes(files) {
  return files
    .filter((file) => !file.image && !(file.audio && !file.image))
    .reduce((sum, file) => sum + (Number(file.size) || 0), 0);
}

function namedAttachment(item) {
  const link = externalOf(item);
  if (!link) return null;
  return { name: link.name, mime: link.mime, stored: false };
}

function videoOf(item) {
  const url = typeof item === "string" ? item : item?.url;
  if (typeof url !== "string" || !url) return null;
  const video = { url, stored: false };
  if (item && typeof item === "object" && typeof item.poster === "string" && item.poster) video.poster = item.poster;
  if (item && typeof item === "object" && typeof item.playUrl === "string" && item.playUrl) video.playUrl = item.playUrl;
  return video;
}

function when(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const ACTORS = new Set(["person", "personal_agent", "platform"]);

export function toRecord(row, { files = [], granted = false, author, starred = false, liked = false } = {}) {
  if (!row) return null;
  const links = bag(row.links);
  const kind = row.kind || "post";
  const visible = Boolean(granted);
  const images = files.filter((file) => file.image).map((file) => storedOf(file));
  const audio = [
    ...files.filter((file) => file.audio && !file.image).map((file) => storedOf(file)),
    ...(Array.isArray(links.audio) ? links.audio : []).map(externalOf).filter(Boolean),
  ];
  const attachments = [
    ...files.filter((file) => !file.image && !file.audio).map((file) => storedOf(file)),
    ...(Array.isArray(links.attachments) ? links.attachments : []).map(namedAttachment).filter(Boolean),
  ];
  const videos = (Array.isArray(row.videos) ? row.videos : []).map(videoOf).filter(Boolean);
  const createdAt = when(row.created_at);
  const updatedAt = when(row.updated_at) || createdAt;
  // 下载服务费：按附件字节计价，平台收，加在作者标价之上。
  const fee = serviceFee(
    attachmentBytes(files),
    economyConfig().downloadServiceFeePerMb,
    economyConfig().serviceFeeCap
  );
  const record = {
    id: row.id,
    kMeta: {
      id: row.id,
      hash: row.content_hash || "",
      kind,
      respondsTo: row.responds_to || null,
      version: Number(row.version) || 1,
      originId: row.origin_id || null,
      public: row.is_public !== false,
      commerce: {
        price: Number(row.price) || 0,
        fee,
        payee: payeeFor(kind),
      },
      category: row.category || "",
      topics: recordTopics(row.detail),
      note: recordText(row.detail, "note"),
      language: recordText(row.detail, "language"),
      verdict: row.verdict || "pending",
      rejectReason: row.reject_reason || null,
      expiresAt: when(row.expires_at),
      weight: Number(row.weight) || 0,
      createdAt,
      updatedAt,
    },
    body: row.body || "",
    images,
    audio,
    videos,
    attachments,
    previewUrl: "",
    granted: visible,
    starred: Boolean(starred),
    liked: Boolean(liked),
  };
  if (ACTORS.has(row.actor)) record.actor = row.actor;
  if (author) record.author = author;
  return record;
}
