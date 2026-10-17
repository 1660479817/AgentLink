import { cardImageUrl } from "./uploads.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_EXT = /\.(mp4|webm|mov|mkv|avi|m4v|mpeg|mpg|3gp|wmv|flv|ogv)$/i;
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|flac|opus|wma)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;
const ATTACHMENT_EXT = /\.(pdf|docx|xlsx|pptx|md|markdown|zip|rar|7z|tar|gz|tgz|bz2|xz)$/i;

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

export const MAX_IMAGES = 9;
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

function posterError() {
  const error = new Error("bad_poster");
  error.code = "bad_poster";
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

// 缩略图由发送方必填，只收平台上传图 { id }，不收外链。
function posterInput(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw posterError();
  if (typeof raw.id === "string") {
    const id = raw.id.trim().toLowerCase();
    if (!UUID.test(id)) throw posterError();
    return { id };
  }
  throw posterError();
}

// 视频项：{ url, poster }。url 是 http/https 链接，poster 是平台上传图 { id }。
export function videoItemsOf(value, limit = MAX_VIDEOS) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw videoError();
  const items = [];
  const seen = new Set();
  for (const item of value) {
    if (items.length >= limit) break;
    if (!item || typeof item !== "object" || Array.isArray(item)) throw posterError();
    const url = videoUrl(typeof item.url === "string" ? item.url.trim() : "");
    if (!url) throw videoError();
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ url, poster: posterInput(item.poster) });
  }
  return items;
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

export function isArchiveUpload(file) {
  const name = String(file?.originalname || file?.name || "");
  return ARCHIVE_EXT.test(name);
}

export function isAttachmentUpload(file) {
  const name = String(file?.originalname || file?.name || "");
  return ATTACHMENT_EXT.test(name);
}

export function fileView(row) {
  const mime = row.mime || "";
  const image = mime.startsWith("image/");
  return {
    id: row.id,
    name: uploadName(row.original_name),
    mime,
    size: Number(row.size) || 0,
    url: image ? cardImageUrl(row.id) : `/api/web/uploads/${row.id}`,
    image,
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

const VIDEO_META_KEYS = new Set(["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]);

function safeAbsolute(raw, base) {
  if (!raw) return "";
  try {
    const url = new URL(raw, base);
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password) return url.toString();
  } catch {
    /* skip a broken address */
  }
  return "";
}

// 从页面里找出可播放的视频直链。落地页不直接给流时，尽力解析 og:video / twitter 流 / 内联 <video><source>。
export function previewVideo(html, base) {
  const doc = String(html || "");
  const tags = doc.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (metaContent(tag, "property") || metaContent(tag, "name")).toLowerCase();
    if (!VIDEO_META_KEYS.has(key)) continue;
    const url = safeAbsolute(metaContent(tag, "content"), base);
    if (url) return url;
  }
  const inline = doc.match(/<(?:video|source)\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/i);
  if (inline) {
    const url = safeAbsolute(inline[1] || inline[2] || inline[3], base);
    if (url) return url;
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

function directMedia(file) {
  return Boolean(file?.image) || Boolean(file?.audio) || isImageFile(file) || isAudioUpload(file);
}

export function listedFiles(files, granted) {
  return (files || []).map((file) => {
    if (granted || directMedia(file)) return file;
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

