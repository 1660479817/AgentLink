import { createHash } from "node:crypto";
import { publicUploadUrl } from "./uploads.js";

export const DEFAULT_AVATAR_COUNT = 16;

export function defaultAvatarUrl(userId) {
  const digest = createHash("sha256").update(String(userId)).digest();
  const index = digest.readUInt32BE(0) % DEFAULT_AVATAR_COUNT;
  return `/avatars/${String(index + 1).padStart(2, "0")}.svg`;
}

export function avatarUrlFor(row) {
  if (!row) return null;
  if (row.avatar_upload_id) return publicUploadUrl(row.avatar_upload_id);
  const id = row.user_id || row.id;
  if (!id) return null;
  return defaultAvatarUrl(id);
}
