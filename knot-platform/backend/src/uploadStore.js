import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { publicUploadUrl, storagePath } from "./uploads.js";

// 每人上传字节上限。0 表示不限；未配置时给 1 GiB，够正常使用，也挡得住把盘写满。
const DEFAULT_QUOTA_BYTES = 1024 * 1024 * 1024;

// 图片只认这几种。SVG 不在内：它带脚本，直接打开 URL 就是同源执行。
export const IMAGE_MIME_BY_FORMAT = Object.freeze({
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
});

const EXT_BY_MIME = Object.freeze({
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
});

// 音频和附件的 MIME 由客户端声明，只能当线索用。声明成 text/html 的文件原样存下来、
// 再原样回给浏览器，就是一个同源脚本（扩展名 .mp3 只影响文件名，不影响浏览器怎么解释）。
// 所以非图片的类型在这里收一次：认得的归一到规范值，认不得的按扩展名给，
// 两者都说不出「这是音频」就不收。存进库的类型永远是服务端选的，不是客户端给的。
const AUDIO_MIME_BY_EXT = Object.freeze({
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".opus": "audio/ogg",
  ".wma": "audio/x-ms-wma",
});

// 浏览器会当成页面/脚本去执行的那几种。附件本来就不内联打开（见 readableUpload），
// 这里把它们记成二进制，免得哪天多一个渲染入口就把这段历史记录带出来。
const RENDERABLE_DOWNLOAD_MIME = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/xml",
  "application/xml",
  "text/javascript",
  "application/javascript",
  "application/ecmascript",
]);

function declaredMime(value) {
  return String(value || "").toLowerCase().split(";")[0].trim();
}

export function safeAudioMime(declared, originalName) {
  const fromExt = AUDIO_MIME_BY_EXT[path.extname(String(originalName || "")).toLowerCase()] || "";
  const raw = declaredMime(declared);
  if (!raw.startsWith("audio/")) return fromExt;
  // 声明是 audio/*：扩展名认得出就按扩展名归一，认不出就保留声明值。
  // 两种结果都是 audio 类型，浏览器不会拿去渲染成页面。
  return fromExt || raw;
}

export function safeAttachmentMime(declared) {
  const raw = declaredMime(declared);
  if (!raw || RENDERABLE_DOWNLOAD_MIME.has(raw)) return "application/octet-stream";
  return raw;
}

// 这张地址能不能让浏览器原地渲染。表外的（含历史遗留的奇怪类型）一律按附件下载，
// 下载只是把同一个字节交给用户，不经过页面的执行环境。
export function isInlineRenderableMime(value) {
  const raw = declaredMime(value);
  if (!raw || raw === "image/svg+xml") return false;
  return raw.startsWith("image/") || raw.startsWith("audio/") || raw.startsWith("video/");
}

export function uploadQuotaBytes() {
  const raw = process.env.KNOT_UPLOAD_QUOTA_BYTES;
  if (raw === undefined || String(raw).trim() === "") return DEFAULT_QUOTA_BYTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return DEFAULT_QUOTA_BYTES;
  return Math.floor(value);
}

export function uploadError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export async function digestFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// 按文件内容判断图片格式。声明的 MIME 只用于初筛，最终以解码结果为准。
// sharp 把 AVIF 和 HEIC 都报成 heif，靠 compression 区分：av1 才是 AVIF。
export async function readImageMeta(file) {
  let meta;
  try {
    meta = await sharp(file, { failOn: "error" }).metadata();
  } catch {
    return null;
  }
  const format = String(meta?.format || "").toLowerCase();
  const mime = format === "heif" && meta.compression === "av1"
    ? "image/avif"
    : IMAGE_MIME_BY_FORMAT[format];
  if (!mime || !meta.width || !meta.height) return null;
  // 记的是卡片显示图的宽高：显示图走 sharp.rotate() 转过 EXIF，竖拍照片在这里也要转过来，
  // 否则库里存成横的，前端按它算多图比例就正好反过来。
  const turned = [5, 6, 7, 8].includes(Number(meta.orientation) || 0);
  return turned
    ? { mime, width: meta.height, height: meta.width }
    : { mime, width: meta.width, height: meta.height };
}

// 存储名由客户端文件名生成，扩展名可能和真实格式不符。按内容改回规范扩展名。
// dir 是这个文件当前所在的目录（上传时是 tmp）。
export function alignImageExtension(dir, storageName, mime) {
  const want = EXT_BY_MIME[mime];
  if (!want) return storageName;
  const current = path.extname(storageName).toLowerCase();
  if (current === want || (want === ".jpg" && current === ".jpeg")) return storageName;
  const next = `${path.basename(storageName, path.extname(storageName))}${want}`;
  fs.renameSync(path.join(dir, storageName), path.join(dir, next));
  return next;
}

// tmp 里校验完的原件挪进 blobs 分片。同一块盘，rename 不复制字节。
function moveIntoBlobs(uploadDir, tmpFile, storageName) {
  const dest = storagePath(uploadDir, storageName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  try {
    fs.renameSync(tmpFile, dest);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    // 跨文件系统时复制，复制失败不能留下半截原件。
    try {
      fs.copyFileSync(tmpFile, dest);
    } catch (copyError) {
      fs.rmSync(dest, { force: true });
      throw copyError;
    }
    fs.rmSync(tmpFile, { force: true });
  }
  return dest;
}

// 上传配额按钱包算：Agent 传的东西和主人共用一个上限，不按账号各开一份。
export async function userUploadBytes(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(u.size), 0) AS total
       FROM uploads u
       JOIN accounts a ON a.id = u.account_id
      WHERE COALESCE(a.owner_id, a.id) = COALESCE(
        (SELECT COALESCE(owner_id, id) FROM accounts WHERE id = $1), $1
      )`,
    [userId]
  );
  return Number(rows[0]?.total || 0);
}

function removeFile(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // 删不掉就留给审计脚本报出来，不要盖住原来的错误。
  }
}

// 落盘校验、计量、写库放在一处。任何一步失败都删掉刚写的文件，不留孤儿。
export async function storeUploadedFile({ uploadDir, pool, userId, file, kind, name = null, skipQuota = false }) {
  if (!file?.path || !uploadDir) throw uploadError("upload_failed");
  let bytes;
  try {
    bytes = fs.statSync(file.path).size;
  } catch {
    throw uploadError("upload_failed");
  }

  let mime = String(file.mimetype || "");
  let width = null;
  let height = null;
  if (kind === "image") {
    const meta = await readImageMeta(file.path);
    if (!meta) {
      removeFile(file.path);
      throw uploadError("bad_mime");
    }
    mime = meta.mime;
    width = meta.width;
    height = meta.height;
  } else if (kind === "audio") {
    mime = safeAudioMime(mime, file.originalname);
    if (!mime) {
      removeFile(file.path);
      throw uploadError("bad_audio");
    }
  } else {
    mime = safeAttachmentMime(mime);
  }

  if (!skipQuota) {
    const limit = uploadQuotaBytes();
    if (limit > 0) {
      const used = await userUploadBytes(pool, userId);
      if (used + bytes > limit) {
        removeFile(file.path);
        throw uploadError("quota_exceeded");
      }
    }
  }

  let sha256;
  try {
    sha256 = await digestFile(file.path);
  } catch {
    removeFile(file.path);
    throw uploadError("upload_failed");
  }

  // 改扩展名之后，磁盘上的文件名已经变了，后续搬运必须用新路径；file.path 仍是旧名。
  let storageName = file.filename;
  let stagedPath = file.path;
  try {
    if (kind === "image") {
      storageName = alignImageExtension(path.dirname(file.path), storageName, mime);
      stagedPath = path.join(path.dirname(file.path), storageName);
    }
  } catch {
    removeFile(file.path);
    throw uploadError("upload_failed");
  }

  let blob;
  try {
    blob = moveIntoBlobs(uploadDir, stagedPath, storageName);
  } catch {
    removeFile(stagedPath);
    removeFile(file.path);
    throw uploadError("upload_failed");
  }

  let inserted;
  try {
    inserted = await pool.query(
      `INSERT INTO uploads (account_id, storage_name, mime, original_name, size, sha256, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [userId, storageName, mime, name || null, bytes, sha256, width, height]
    );
  } catch (error) {
    removeFile(blob);
    throw error;
  }

  const id = inserted.rows[0].id;
  return { id, url: publicUploadUrl(id), name: name || null, mime, bytes, sha256, width, height };
}
