#!/usr/bin/env node
// 把 uploads 里缺的 size / sha256 / 宽高从磁盘补上，并报告没有引用的文件。
// 默认只报告，不改库。确认后加 --apply。
//
//   set -a; source sites/<站点>/platform.env; set +a
//   node backend/scripts/backfill-uploads.mjs
//   node backend/scripts/backfill-uploads.mjs --apply
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import sharp from "sharp";
import { loadBootstrapConfig } from "../src/config.js";
import { blobPath, blobsDir, readableBlobPath } from "../src/storage.js";

const APPLY = process.argv.includes("--apply");

// 原件在 blobs/<前两位>/ 里；旧布局的还在根目录。两处都要算进来。
function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

async function digest(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function imageMeta(file) {
  try {
    const meta = await sharp(file, { failOn: "error" }).metadata();
    if (!meta?.width || !meta?.height) return null;
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

function human(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 * 1024) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

async function main() {
  const { databaseUrl, uploadDir } = loadBootstrapConfig();
  const root = path.resolve(uploadDir);
  if (!fs.existsSync(root)) throw new Error(`上传目录不存在：${root}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  console.log(`目录 ${root}`);
  console.log(APPLY ? "模式：写入" : "模式：只报告（加 --apply 写入）");

  const { rows } = await client.query(
    `SELECT id, storage_name, mime, size, sha256, width, height FROM uploads ORDER BY created_at`
  );
  // 名字 → 实际路径。原件在 blobs/ 的分片里，统计字节时必须用这个路径，不能拼回根目录。
  const files = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile()) files.set(entry.name, path.join(root, entry.name));
  }
  for (const file of walk(blobsDir(root))) {
    const name = path.basename(file);
    if (!files.has(name)) files.set(name, file);
  }

  let missing = 0;
  let zero = 0;
  let updated = 0;
  let bytesOnDisk = 0;
  let legacy = 0;
  const unreadable = [];

  for (const row of rows) {
    files.delete(path.basename(row.storage_name));
    const file = readableBlobPath(root, row.storage_name);
    if (file !== blobPath(root, row.storage_name)) legacy += 1;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      unreadable.push(`${row.id} ${row.storage_name}`);
      missing += 1;
      continue;
    }
    bytesOnDisk += stat.size;
    const needsSize = Number(row.size) !== stat.size;
    // 文件被改写过时（例如头像收成 512），旧摘要和宽高也不能信，按磁盘重算。
    const needsDigest = !row.sha256 || needsSize;
    const needsBox = String(row.mime || "").startsWith("image/") && (!row.width || !row.height || needsSize);
    if (!needsSize && !needsDigest && !needsBox) continue;
    if (Number(row.size) === 0) zero += 1;

    let width = row.width;
    let height = row.height;
    if (needsBox) {
      const meta = await imageMeta(file);
      if (meta) {
        width = meta.width;
        height = meta.height;
      }
    }
    const sha256 = needsDigest ? await digest(file) : row.sha256;
    if (APPLY) {
      await client.query(
        `UPDATE uploads SET size = $2, sha256 = $3, width = $4, height = $5 WHERE id = $1`,
        [row.id, stat.size, sha256, width || null, height || null]
      );
    }
    updated += 1;
  }

  console.log(`库内 ${rows.length} 行，磁盘 ${human(bytesOnDisk)}，本次${APPLY ? "写入" : "待写入"} ${updated} 行（其中 size 为 0 的 ${zero} 行）`);
  if (legacy) console.log(`有 ${legacy} 行的文件还在旧位置，运行 migrate-storage-layout.mjs 搬到 blobs/`);
  if (missing) console.log(`缺文件 ${missing} 行`);
  for (const line of unreadable.slice(0, 20)) console.log(`  缺 ${line}`);
  if (missing > 20) console.log(`  ……另有 ${missing - 20} 行`);

  if (files.size) {
    const orphanBytes = [...files.values()].reduce((sum, file) => {
      try {
        return sum + fs.statSync(file).size;
      } catch {
        return sum;
      }
    }, 0);
    console.log(`磁盘上 ${files.size} 个文件没有库记录，${human(orphanBytes)}（审计脚本会列出；GC 按宽限期跳过最近上传的）`);
  }

  const orphans = await client.query(
    `WITH poster_uploads AS (
       SELECT DISTINCT (regexp_match(video->>'poster',
         '/api/web/uploads/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/display'))[1]::uuid AS id
       FROM intel i
       CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(i.videos) = 'array' THEN i.videos ELSE '[]'::jsonb END
       ) AS video
     ),
     used AS (
       SELECT upload_id AS id FROM intel_files
       UNION SELECT avatar_upload_id FROM accounts WHERE avatar_upload_id IS NOT NULL
       UNION SELECT image_upload_id FROM sponsors WHERE image_upload_id IS NOT NULL
       UNION SELECT id FROM poster_uploads WHERE id IS NOT NULL
     )
     SELECT count(*)::int AS n, COALESCE(sum(size), 0) AS bytes
     FROM uploads u WHERE NOT EXISTS (SELECT 1 FROM used x WHERE x.id = u.id)`
  );
  console.log(`库内 ${orphans.rows[0].n} 行没有引用，${human(orphans.rows[0].bytes)}`);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
