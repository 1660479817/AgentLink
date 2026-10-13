import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const AVATAR_PX = 512;

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
  if (!size || size.width !== size.height) return "bad_avatar_square";
  if (size.width !== AVATAR_PX) return "bad_avatar_size";
  return null;
}

export async function acceptAvatar(pool, uploadDir, userId, uploadId) {
  const { rows } = await pool.query(
    `SELECT id, storage_name FROM uploads WHERE id = $1 AND user_id = $2 AND mime LIKE 'image/%'`,
    [uploadId, userId]
  );
  if (!rows.length) return { error: "bad_avatar" };
  let buffer;
  try {
    buffer = fs.readFileSync(storagePath(uploadDir, rows[0].storage_name));
  } catch {
    return { error: "bad_avatar" };
  }
  const error = avatarBufferError(buffer);
  if (error) return { error };
  return { id: rows[0].id };
}
