import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

export const AVATAR_PX = 512;
const AVATAR_JPEG_QUALITY = 85;
const AVATAR_FLATTEN_BACKGROUND = "#ffffff";

export function ensureUploadDir(uploadDir) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

export function storagePath(uploadDir, storageName) {
  return path.join(uploadDir, storageName);
}

export function newStorageName(originalName) {
  const ext = path.extname(originalName || "").slice(0, 8) || ".bin";
  return `${randomUUID()}${ext}`;
}

export function publicUploadUrl(uploadId) {
  return `/api/web/uploads/${uploadId}`;
}

// 卡片列最宽 680px。1280 盖住这块在两倍屏上的宽度，不再把手机原图送进信息流。
export const CARD_IMAGE_EDGE = 1280;
const CARD_JPEG_QUALITY = 80;
const cardJobs = new Map();

export function cardImageUrl(uploadId) {
  return `${publicUploadUrl(uploadId)}/display`;
}

export function cardImagePath(uploadDir, storageName) {
  return path.join(uploadDir, "display", `${path.basename(storageName)}.jpg`);
}

export function ensureCardImage(uploadDir, storageName) {
  const dest = cardImagePath(uploadDir, storageName);
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  const current = cardJobs.get(dest);
  if (current) return current;
  const job = writeCardImage(storagePath(uploadDir, storageName), dest).finally(() => {
    if (cardJobs.get(dest) === job) cardJobs.delete(dest);
  });
  cardJobs.set(dest, job);
  return job;
}

async function writeCardImage(source, dest) {
  await fs.promises.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${randomUUID()}.tmp`;
  try {
    await sharp(source)
      .rotate()
      .resize({ width: CARD_IMAGE_EDGE, height: CARD_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: CARD_JPEG_QUALITY })
      .toFile(tmp);
    await fs.promises.rename(tmp, dest);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true });
    throw error;
  }
  return dest;
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb]);

export function imageSize(buffer) {
  if (!buffer || buffer.length < 10) return null;
  if (buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG" && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return jpegSize(buffer);
  const kind = buffer.toString("ascii", 0, 6);
  if (kind === "GIF87a" || kind === "GIF89a") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return webpSize(buffer);
  return null;
}

function jpegSize(buffer) {
  let i = 2;
  while (i + 9 < buffer.length) {
    if (buffer[i] !== 0xff) return null;
    const marker = buffer[i + 1];
    if (marker === 0xd8) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = buffer.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > buffer.length) return null;
    if (SOF.has(marker)) {
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(buffer) {
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X" && buffer.length >= 30) {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8 ") {
    const start = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (start >= 0 && start + 7 <= buffer.length) {
      return { width: buffer.readUInt16LE(start + 3) & 0x3fff, height: buffer.readUInt16LE(start + 5) & 0x3fff };
    }
  }
  return null;
}

export function avatarBufferError(buffer) {
  const size = imageSize(buffer);
  if (!size || size.width !== size.height || size.width < 1) return "bad_avatar_square";
  return null;
}

export async function fitAvatar(buffer) {
  const size = imageSize(buffer);
  if (!size || size.width <= AVATAR_PX) return null;
  // 透明头像转成 JPEG 会把透明区域压成纯黑，先垫白底。
  return sharp(buffer)
    .rotate()
    .resize(AVATAR_PX, AVATAR_PX, { fit: "cover" })
    .flatten({ background: AVATAR_FLATTEN_BACKGROUND })
    .jpeg({ quality: AVATAR_JPEG_QUALITY })
    .toBuffer();
}

export async function acceptAvatar(pool, uploadDir, userId, uploadId) {
  const { rows } = await pool.query(
    `SELECT id, storage_name, mime FROM uploads WHERE id = $1 AND user_id = $2 AND mime LIKE 'image/%'`,
    [uploadId, userId]
  );
  if (!rows.length) return { error: "bad_avatar" };
  const row = rows[0];
  let buffer;
  try {
    buffer = fs.readFileSync(storagePath(uploadDir, row.storage_name));
  } catch {
    return { error: "bad_avatar" };
  }
  const error = avatarBufferError(buffer);
  if (error) return { error };
  let fitted;
  try {
    fitted = await fitAvatar(buffer);
  } catch {
    return { error: "bad_avatar" };
  }
  if (!fitted) return { id: row.id };
  const ext = path.extname(row.storage_name);
  const nextName =
    ext.toLowerCase() === ".jpg" || ext.toLowerCase() === ".jpeg"
      ? row.storage_name
      : `${path.basename(row.storage_name, ext)}.jpg`;
  try {
    fs.writeFileSync(storagePath(uploadDir, nextName), fitted);
    if (nextName !== row.storage_name || row.mime !== "image/jpeg") {
      await pool.query(`UPDATE uploads SET storage_name = $1, mime = 'image/jpeg' WHERE id = $2`, [
        nextName,
        row.id,
      ]);
    }
    if (nextName !== row.storage_name) fs.rmSync(storagePath(uploadDir, row.storage_name), { force: true });
  } catch {
    return { error: "bad_avatar" };
  }
  return { id: row.id };
}
