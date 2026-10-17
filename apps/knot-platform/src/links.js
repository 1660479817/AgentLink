import { createHash } from "node:crypto";
import { publicUploadUrl } from "./uploads.js";
import { reachable } from "./videoPoster.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD = /\/api\/web\/uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/display)?(?:$|[?#])/i;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function readMedia(value, limit) {
  const ids = [];
  const urls = [];
  const list = Array.isArray(value) ? value : [];
  for (const item of list) {
    if (ids.length + urls.length >= limit) break;
    const text = typeof item === "string" ? item.trim() : "";
    const objectId = item && typeof item === "object" && typeof item.id === "string" ? item.id.trim() : "";
    const objectUrl = item && typeof item === "object" && typeof item.url === "string" ? item.url.trim() : "";
    const raw = text || objectId || objectUrl;
    if (!raw) continue;
    if (UUID.test(raw)) {
      ids.push(raw);
      continue;
    }
    const local = raw.match(UPLOAD);
    if (local) {
      ids.push(local[1]);
      continue;
    }
    if (/^https?:\/\//i.test(raw)) {
      urls.push(raw);
      continue;
    }
    throw fail("bad_url");
  }
  return { ids, urls };
}

// 图片只收平台上传 id，不收外链。收到外链时报 bad_image。
export function readImageMedia(value, limit) {
  const { ids, urls } = readMedia(value, limit);
  if (urls.length) throw fail("bad_image");
  return ids;
}

function storedAddress(id) {
  return publicUploadUrl(String(id).toLowerCase());
}

export function contentHash({
  kind,
  respondsTo = null,
  body = "",
  imageIds = [],
  imageUrls = [],
  audioIds = [],
  audioUrls = [],
  fileIds = [],
  fileUrls = [],
  videos = [],
}) {
  const payload = JSON.stringify([
    kind,
    respondsTo ? String(respondsTo).toLowerCase() : "",
    body || "",
    [...imageIds.map(storedAddress), ...imageUrls],
    [...audioIds.map(storedAddress), ...audioUrls],
    videos,
    [...fileIds.map(storedAddress), ...fileUrls],
  ]);
  return createHash("sha256").update(payload).digest("hex");
}

export async function assertReachable(urls) {
  for (const url of urls) {
    await reachable(url);
  }
}
