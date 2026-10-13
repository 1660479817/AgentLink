import { randomUUID } from "node:crypto";
import { access, mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { loadBootstrapConfig } from "./config.js";
import { storagePath } from "./uploads.js";

export const PREVIEW_WIDTH = 960;
const GAP = 2;
const JPEG_QUALITY = 70;

export function previewFrame(count, width = PREVIEW_WIDTH) {
  const n = Math.min(4, Math.max(1, Number(count) || 1));
  if (n === 1) return { width, height: 0, cells: [] };
  if (n === 2) {
    const height = Math.round(width / 2);
    const cell = Math.floor((width - GAP) / 2);
    const right = width - GAP - cell;
    return {
      width,
      height,
      cells: [
        { x: 0, y: 0, w: cell, h: height },
        { x: cell + GAP, y: 0, w: right, h: height },
      ],
    };
  }
  if (n === 3) {
    const height = Math.round((width * 2) / 3);
    const left = Math.round(((width - GAP) * 1.4) / 2.4);
    const right = width - GAP - left;
    const top = Math.floor((height - GAP) / 2);
    const bottom = height - GAP - top;
    return {
      width,
      height,
      cells: [
        { x: 0, y: 0, w: left, h: height },
        { x: left + GAP, y: 0, w: right, h: top },
        { x: left + GAP, y: top + GAP, w: right, h: bottom },
      ],
    };
  }
  const height = width;
  const left = Math.round(((width - GAP) * 1.4) / 2.4);
  const right = width - GAP - left;
  const row = Math.floor((height - GAP * 2) / 3);
  const last = height - (row + GAP) * 2;
  return {
    width,
    height,
    cells: [
      { x: 0, y: 0, w: left, h: height },
      { x: left + GAP, y: 0, w: right, h: row },
      { x: left + GAP, y: row + GAP, w: right, h: row },
      { x: left + GAP, y: (row + GAP) * 2, w: right, h: last },
    ],
  };
}

export function previewFilePath(uploadDir, intelId) {
  return path.join(uploadDir, "previews", `${path.basename(String(intelId))}.jpg`);
}

export async function writeCardPreview(sources, dest) {
  const images = sources.slice(0, 4).filter(Boolean);
  if (!images.length) return "";
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${randomUUID()}.tmp`;
  if (images.length === 1) {
    await sharp(images[0])
      .rotate()
      .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(tmp);
  } else {
    const frame = previewFrame(images.length);
    const layers = await Promise.all(
      frame.cells.map(async (cell, index) => ({
        input: await sharp(images[index])
          .rotate()
          .resize(cell.w, cell.h, { fit: "cover", position: "centre" })
          .jpeg({ quality: JPEG_QUALITY })
          .toBuffer(),
        left: cell.x,
        top: cell.y,
      }))
    );
    await sharp({
      create: {
        width: frame.width,
        height: frame.height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite(layers)
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(tmp);
  }
  await rename(tmp, dest);
  return dest;
}

async function imagePaths(pool, uploadDir, intelId) {
  const { rows } = await pool.query(
    `SELECT u.storage_name
     FROM intel_files f
     JOIN uploads u ON u.id = f.upload_id
     WHERE f.intel_id = $1 AND u.mime LIKE 'image/%'
     ORDER BY f.sort_order ASC, f.upload_id ASC
     LIMIT 4`,
    [intelId]
  );
  const files = [];
  for (const row of rows) {
    const file = storagePath(uploadDir, row.storage_name);
    try {
      await access(file);
      files.push(file);
    } catch {
      /* a missing original is skipped */
    }
  }
  return files;
}

export async function ensureCardPreview(pool, intelId, uploadDir = loadBootstrapConfig().uploadDir) {
  const sources = await imagePaths(pool, uploadDir, intelId);
  if (!sources.length) return "";
  const dest = previewFilePath(uploadDir, intelId);
  try {
    await access(dest);
    return dest;
  } catch {
    return writeCardPreview(sources, dest);
  }
}

export async function removeCardPreview(intelId, uploadDir = loadBootstrapConfig().uploadDir) {
  try {
    await unlink(previewFilePath(uploadDir, intelId));
  } catch {
    /* already gone */
  }
}

export async function previewReadable(pool, intelId, userId) {
  const { rows } = await pool.query(
    `SELECT i.user_id, i.verdict, i.is_public, i.kind, i.responds_to,
            EXISTS (
              SELECT 1 FROM intel_files f
              JOIN uploads u ON u.id = f.upload_id
              WHERE f.intel_id = i.id AND u.mime LIKE 'image/%'
            ) AS has_image
     FROM intel i
     WHERE i.id = $1`,
    [intelId]
  );
  const row = rows[0];
  if (!row || !row.has_image) return false;
  if (userId && row.user_id === userId) return true;
  if (row.verdict === "passed" && row.is_public && (row.kind === "post" || row.kind === "fastpost")) return true;
  if (!userId) return false;
  const paid = await pool.query(`SELECT 1 FROM packet_downloads WHERE intel_id = $1 AND user_id = $2`, [intelId, userId]);
  if (paid.rows.length) return true;
  if (row.kind === "wishRespond" && row.responds_to) {
    const wish = await pool.query(
      `SELECT 1 FROM intel WHERE id = $1 AND kind = 'wish' AND user_id = $2`,
      [row.responds_to, userId]
    );
    if (wish.rows.length) return true;
  }
  return false;
}
