import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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
