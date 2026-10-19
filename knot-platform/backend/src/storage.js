import fs from "node:fs";
import path from "node:path";

// 上传目录的布局只在这里决定。别处不要自己拼 `join(uploadDir, "display")`。
//
//   <UPLOAD_DIR>/
//     blobs/<前两位>/<storage_name>   原件，唯一真源
//     derived/display/…               卡片图，可重建
//     derived/packets/…               下载包，可重建
//     derived/extracts/…              终审转写，重建要再跑一次评审
//     derived/shares/…                分享图，可重建
//     tmp/                            刚收到、还没入库的文件
//     board/                          公开快照（沿用旧位置，由 DISCOVER_BOARD_DIR 覆盖）
//     previews/                       旧版拼图，只读，不再写入

export const LAYOUT = Object.freeze({
  blobs: "blobs",
  derived: "derived",
  tmp: "tmp",
  board: "board",
});

export const DERIVED_KINDS = Object.freeze(["display", "packets", "extracts", "shares"]);

export const SHARD_LENGTH = 2;

// storage_name 是 `{uuid}.{ext}`。分片只用字母数字，异常名字落到 `_`，不会跑出目录。
export function shardOf(storageName) {
  const name = String(storageName || "");
  const head = name.slice(0, SHARD_LENGTH).toLowerCase();
  if (!head) return "_";
  return /^[0-9a-z]+$/.test(head) ? head : "_";
}

export function blobsDir(uploadDir) {
  return path.join(uploadDir, LAYOUT.blobs);
}

export function blobPath(uploadDir, storageName) {
  const name = path.basename(String(storageName || ""));
  return path.join(blobsDir(uploadDir), shardOf(name), name);
}

// 旧布局把原件放在根目录。读的时候回落一次，切换当天不需要卡着迁移完成。
export function legacyBlobPath(uploadDir, storageName) {
  return path.join(uploadDir, path.basename(String(storageName || "")));
}

export function readableBlobPath(uploadDir, storageName) {
  const current = blobPath(uploadDir, storageName);
  if (exists(current)) return current;
  const legacy = legacyBlobPath(uploadDir, storageName);
  return exists(legacy) ? legacy : current;
}

export function tmpDir(uploadDir) {
  return path.join(uploadDir, LAYOUT.tmp);
}

export function tmpPath(uploadDir, storageName) {
  return path.join(tmpDir(uploadDir), path.basename(String(storageName || "")));
}

export function derivedDir(uploadDir, kind) {
  return path.join(uploadDir, LAYOUT.derived, String(kind));
}

export function legacyDerivedDir(uploadDir, kind) {
  return path.join(uploadDir, String(kind));
}

export function boardDir(uploadDir) {
  return path.join(uploadDir, LAYOUT.board);
}

export function legacyPreviewDir(uploadDir) {
  return path.join(uploadDir, "previews");
}

export function ensureLayout(uploadDir) {
  const root = String(uploadDir || "");
  if (!root) throw new Error("upload_dir_missing");
  fs.mkdirSync(path.join(blobsDir(root)), { recursive: true });
  fs.mkdirSync(tmpDir(root), { recursive: true });
  for (const kind of DERIVED_KINDS) fs.mkdirSync(derivedDir(root, kind), { recursive: true });
}

function exists(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}
