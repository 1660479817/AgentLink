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
  return { mime, width: meta.width, height: meta.height };
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

export async function userUploadBytes(pool, userId) {
  const { rows } = await pool.query(
    `SELECT COALESCE(sum(size), 0) AS total FROM uploads WHERE user_id = $1`,
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
  } else if (!mime) {
    removeFile(file.path);
    throw uploadError("bad_mime");
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
      `INSERT INTO uploads (user_id, storage_name, mime, original_name, size, sha256, width, height)
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
