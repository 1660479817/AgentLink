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
//     board/                          公开快照（由 DISCOVER_BOARD_DIR 覆盖）

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

export function readableBlobPath(uploadDir, storageName) {
  return blobPath(uploadDir, storageName);
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

export function boardDir(uploadDir) {
  return path.join(uploadDir, LAYOUT.board);
}

export function ensureLayout(uploadDir) {
  const root = String(uploadDir || "");
  if (!root) throw new Error("upload_dir_missing");
  fs.mkdirSync(path.join(blobsDir(root)), { recursive: true });
  fs.mkdirSync(tmpDir(root), { recursive: true });
  for (const kind of DERIVED_KINDS) fs.mkdirSync(derivedDir(root, kind), { recursive: true });
}

// 「这行 upload 还有没有引用」只写一份，审计脚本与 GC 共用：两边各写一条，
// 少一类引用就会把仍被正文嵌着的图报成孤儿（S11-11）。videos 不是数组的历史行要跳过，
// 否则 jsonb_array_elements 直接报错。
export const USED_UPLOADS_SQL = `
  SELECT upload_id AS id FROM intel_files
  UNION SELECT avatar_upload_id FROM accounts WHERE avatar_upload_id IS NOT NULL
  UNION SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL
  UNION SELECT (regexp_match(v->>'poster', '/api/web/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/display'))[1]::uuid
        FROM intel i
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(i.videos) = 'array' THEN i.videos ELSE '[]'::jsonb END
        ) v
        WHERE v->>'poster' ~ '/api/web/uploads/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/display'
  UNION SELECT (m)[1]::uuid
        FROM intel i
        CROSS JOIN LATERAL regexp_matches(
          i.body, '/api/web/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g'
        ) m
        WHERE i.body LIKE '%/api/web/uploads/%'
`;

// 派生件还该不该留：display 按原件的 storage_name，其余按记录 id。
// 文件名大小写不敏感（storage_name 一律小写，历史行可能不是）。
export function keepDerivedFile(kind, relativePath, storageNames, intelIds) {
  const head = String(relativePath || "").split(path.sep)[0];
  if (kind === "display") return storageNames.has(path.basename(head, ".jpg").toLowerCase());
  if (kind === "packets") return intelIds.has(head.replace(/\.zip$/i, "").toLowerCase());
  if (kind === "extracts") return intelIds.has(head.replace(/\.md$/i, "").toLowerCase());
  if (kind === "shares") return intelIds.has(head.toLowerCase());
  return true;
}
