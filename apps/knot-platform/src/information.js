const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg|3gp|wmv|flv|ogv)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$/i;
const ATTACHMENT_EXT = /\.(pdf|docx|xlsx|pptx|md|markdown)$/i;

export function visibleVerdict(column = "verdict") {
  return `${column} IN ('pending', 'passed')`;
}

export function uploadName(raw) {
  const value = String(raw || "");
  if (!value) return "";
  let text = value;
  let bytes = true;
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) > 255) {
      bytes = false;
      break;
    }
  }
  if (bytes) {
    const encoded = Buffer.from(value, "latin1");
    const decoded = encoded.toString("utf8");
    if (!decoded.includes("\uFFFD") && Buffer.from(decoded, "utf8").equals(encoded)) text = decoded;
  }
  const base = text.split(/[/\\]/).pop() || text;
  return [...base].slice(0, 180).join("");
}

export const MAX_IMAGES = 4;
export const MAX_AUDIO = 1;
export const MAX_FILES = 1;
export const MAX_VIDEOS = 1;

export function idsOf(value, limit) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    const id = typeof item === "string" ? item : item?.id;
    if (typeof id !== "string" || !UUID.test(id) || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= limit) break;
  }
  return ids;
}

function videoError() {
  const error = new Error("bad_video");
  error.code = "bad_video";
  return error;
}

function videoUrl(raw) {
  const text = raw.trim();
  if (!text || text.length > 2000) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  if (url.username || url.password) return "";
  return url.toString();
}

export function videosOf(value, limit = MAX_VIDEOS) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw videoError();
  const videos = [];
  const seen = new Set();
  for (const item of value) {
    if (videos.length >= limit) break;
    const raw = typeof item === "string" ? item : item && typeof item === "object" ? item.url : null;
    if (typeof raw !== "string") throw videoError();
    const url = videoUrl(raw);
    if (!url) throw videoError();
    if (seen.has(url)) continue;
    seen.add(url);
    videos.push(url);
  }
  return videos;
}

export function publicOf(value) {
  if (value == null || value === "") return true;
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (text === "on") return true;
    if (text === "off") return false;
  }
  const error = new Error("bad_public");
  error.code = "bad_public";
  throw error;
}

export function isAudioUpload(file) {
  const mime = String(file?.mimetype || file?.mime || file?.type || "").toLowerCase();
  if (mime.startsWith("audio/")) return true;
  const name = String(file?.originalname || file?.name || "");
  return AUDIO_EXT.test(name);
}

export function isVideoUpload(file) {
  const mime = String(file?.mimetype || file?.mime || file?.type || "").toLowerCase();
  if (mime.startsWith("video/")) return true;
  const name = String(file?.originalname || file?.name || "");
  return VIDEO_EXT.test(name);
}

export function isAttachmentUpload(file) {
  const name = String(file?.originalname || file?.name || "");
  return ATTACHMENT_EXT.test(name);
}

export function fileView(row) {
  const mime = row.mime || "";
  return {
    id: row.id,
    name: uploadName(row.original_name),
    mime,
    size: Number(row.size) || 0,
    url: `/api/web/uploads/${row.id}`,
    image: mime.startsWith("image/"),
    audio: mime.startsWith("audio/") || isAudioUpload({ mime, originalname: row.original_name }),
  };
}

function partOf(file) {
  return {
    id: file.id,
    url: file.url,
    name: file.name || "",
    mime: file.mime || "",
  };
}

export function knownPoster(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  const host = parsed.hostname.replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") id = parsed.pathname.split("/").filter(Boolean)[0] || "";
  if (host === "youtube.com" || host === "m.youtube.com") {
    const fromPath = parsed.pathname.match(/\/(?:shorts|embed)\/([^/?]+)/);
    id = parsed.searchParams.get("v") || fromPath?.[1] || "";
  }
  if (!id || !/^[\w-]{6,}$/.test(id)) return "";
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function metaContent(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[1] || match[2] || match[3] || "" : "";
}

export function previewImage(html, base) {
  const tags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (metaContent(tag, "property") || metaContent(tag, "name")).toLowerCase();
    if (key !== "og:image" && key !== "og:image:url" && key !== "twitter:image") continue;
    const content = metaContent(tag, "content");
    if (!content) continue;
    try {
      const url = new URL(content, base);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) return url.toString();
    } catch {
      /* skip a broken preview address */
    }
  }
  return "";
}

function posterOf(item) {
  if (!item || typeof item !== "object" || typeof item.poster !== "string") return "";
  try {
    const url = new URL(item.poster);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function videoParts(videos) {
  const list = Array.isArray(videos) ? videos : [];
  const parts = [];
  const seen = new Set();
  for (const item of list) {
    const url = typeof item === "string" ? item : item?.url;
    if (typeof url !== "string" || !url || seen.has(url)) continue;
    seen.add(url);
    const poster = posterOf(item) || knownPoster(url);
    parts.push(poster ? { url, poster } : { url });
  }
  return parts;
}

export function informationOf({ body = "", files = [], videos = [] }) {
  const images = [];
  const audio = [];
  const attachments = [];
  for (const file of files) {
    const part = partOf(file);
    if (file.image) images.push(part);
    else if (file.audio) audio.push(part);
    else attachments.push(part);
  }
  return {
    body: typeof body === "string" ? body.trim() : "",
    images,
    audio,
    videos: videoParts(videos),
    attachments,
  };
}

export function hasInformation(info) {
  return Boolean(info.body || info.images?.length || info.audio?.length || info.videos?.length || info.attachments?.length);
}

export function listedFiles(files, granted) {
  return (files || []).map((file) => {
    if (granted) return file;
    return {
      name: file.name || "",
      mime: file.mime || "",
      image: Boolean(file.image),
      audio: Boolean(file.audio),
    };
  });
}

function isImageFile(file) {
  return Boolean(file?.image) || String(file?.mime || "").startsWith("image/");
}

export function cardFiles(files, granted) {
  return listedFiles(files, granted).map((file) => {
    if (!isImageFile(file)) return file;
    return {
      name: file.name || "",
      mime: file.mime || "",
      image: true,
    };
  });
}

export function cardPreviewUrl(id, files) {
  if (!id || !(files || []).some(isImageFile)) return "";
  return `/api/web/previews/${id}`;
}
