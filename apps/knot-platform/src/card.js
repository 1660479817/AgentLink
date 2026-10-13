import { cardPreviewUrl } from "./information.js";

export function payeeFor(kind) {
  return kind === "wish" ? "platform" : "author";
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

function storedOf(file, granted) {
  const link = {
    name: file.name || "",
    mime: file.mime || "",
    stored: true,
  };
  if (!file.image && granted && file.url) link.url = file.url;
  return link;
}

function videoOf(item) {
  const url = typeof item === "string" ? item : item?.url;
  if (typeof url !== "string" || !url) return null;
  const video = { url, stored: false };
  if (item && typeof item === "object" && typeof item.poster === "string" && item.poster) video.poster = item.poster;
  return video;
}

function when(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toRecord(row, { files = [], granted = false, author, starred = false } = {}) {
  if (!row) return null;
  const links = bag(row.links);
  const kind = row.kind || "post";
  const visible = Boolean(granted);
  const images = [
    ...files.filter((file) => file.image).map((file) => storedOf(file, visible)),
    ...(Array.isArray(links.images) ? links.images : []).map(externalOf).filter(Boolean),
  ];
  const audio = [
    ...files.filter((file) => file.audio && !file.image).map((file) => storedOf(file, visible)),
    ...(Array.isArray(links.audio) ? links.audio : []).map(externalOf).filter(Boolean),
  ];
  const attachments = [
    ...files.filter((file) => !file.image && !file.audio).map((file) => storedOf(file, visible)),
    ...(Array.isArray(links.attachments) ? links.attachments : []).map(externalOf).filter(Boolean),
  ];
  const videos = (Array.isArray(row.videos) ? row.videos : []).map(videoOf).filter(Boolean);
  const createdAt = when(row.created_at);
  const updatedAt = when(row.updated_at) || createdAt;
  const record = {
    id: row.id,
    kMeta: {
      id: row.id,
      hash: row.content_hash || "",
      kind,
      respondsTo: row.responds_to || null,
      version: 1,
      public: row.is_public !== false,
      commerce: {
        price: Number(row.price) || 0,
        payee: payeeFor(kind),
      },
      category: row.category || "",
      verdict: row.verdict || "pending",
      rejectReason: row.reject_reason || null,
      weight: Number(row.weight) || 0,
      createdAt,
      updatedAt,
    },
    body: row.body || "",
    images,
    audio,
    videos,
    attachments,
    previewUrl: cardPreviewUrl(row.id, files) || "",
    granted: visible,
    starred: Boolean(starred),
  };
  if (author) record.author = author;
  return record;
}
