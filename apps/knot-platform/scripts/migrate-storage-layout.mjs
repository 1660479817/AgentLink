#!/usr/bin/env node
// 把旧布局搬到 storage.js 约定的位置：
//   根目录原件 → blobs/<前两位>/…
//   display / packets / extracts / shares → derived/…
// 幂等，可重复执行。默认只报告，加 --apply 才动文件。
//
//   set -a; source ops/env/knot-platform.local.env; set +a
//   node apps/knot-platform/scripts/migrate-storage-layout.mjs
//   node apps/knot-platform/scripts/migrate-storage-layout.mjs --apply
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import { DERIVED_KINDS, blobPath, derivedDir, ensureLayout, legacyDerivedDir } from "../src/storage.js";

const APPLY = process.argv.includes("--apply");
const MOVE = APPLY ? fs.renameSync : () => {};

function moveFile(from, to) {
  if (!fs.existsSync(from)) return false;
  if (fs.existsSync(to)) return false;
  if (APPLY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    MOVE(from, to);
  }
  return true;
}

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

// 搬空之后把空目录从里到外删掉。非空的留着，下一轮再看。
function pruneEmptyTree(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) pruneEmptyTree(path.join(dir, entry.name));
  }
  try {
    if (fs.readdirSync(dir).length) return;
    fs.rmdirSync(dir);
  } catch {
    // 非空或已经删掉了。
  }
}

async function main() {
  const { databaseUrl, uploadDir } = loadBootstrapConfig();
  const root = path.resolve(uploadDir);
  console.log(`根 ${root}`);
  console.log(APPLY ? "模式：移动文件" : "模式：只报告（加 --apply 执行）");

  // 全新机器上目录还不存在，没有东西要搬；--apply 时顺手把布局建好。
  if (!fs.existsSync(root)) {
    if (APPLY) ensureLayout(root);
    console.log(APPLY ? "新建了上传目录布局，没有旧文件要搬" : "上传目录还不存在，无需迁移");
    return;
  }
  if (APPLY) ensureLayout(root);

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const { rows } = await client.query(`SELECT storage_name FROM uploads`);
  await client.end();

  let moved = 0;
  let already = 0;
  let conflicted = 0;
  let missing = 0;

  for (const row of rows) {
    const name = path.basename(String(row.storage_name || ""));
    const from = path.join(root, name);
    const to = blobPath(root, name);
    if (fs.existsSync(to)) {
      already += 1;
      continue;
    }
    if (!fs.existsSync(from)) {
      missing += 1;
      continue;
    }
    if (moveFile(from, to)) moved += 1;
    else conflicted += 1;
  }

  console.log(`原件：库内 ${rows.length} 行，${APPLY ? "移动" : "待移动"} ${moved} 个，已在新位置 ${already} 个，缺文件 ${missing} 个，冲突 ${conflicted} 个`);

  for (const kind of DERIVED_KINDS) {
    const from = legacyDerivedDir(root, kind);
    const to = derivedDir(root, kind);
    if (!fs.existsSync(from)) continue;
    const files = walk(from);
    let done = 0;
    let skipped = 0;
    for (const file of files) {
      const rel = path.relative(from, file);
      if (moveFile(file, path.join(to, rel))) done += 1;
      else skipped += 1;
    }
    console.log(`派生件 ${kind}：${APPLY ? "移动" : "待移动"} ${done} 个，跳过 ${skipped} 个（目标已存在）`);
    if (APPLY && done) {
      pruneEmptyTree(from);
    }
  }

  // 旧版拼图不再写入，只报告，不在这里删。
  const legacyPreview = path.join(root, "previews");
  if (fs.existsSync(legacyPreview)) {
    const files = walk(legacyPreview);
    const bytes = files.reduce((sum, file) => sum + (fs.statSync(file).size || 0), 0);
    console.log(`旧拼图 previews：${files.length} 个，${(bytes / 1024 / 1024).toFixed(1)} MB（只报告，清理见 gc-uploads.mjs）`);
  }

  const expected = ["blobs", "derived", "tmp", "board", "previews", ...DERIVED_KINDS];
  const stray = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !expected.includes(name));
  for (const name of stray) {
    console.log(`未识别的目录：${name}（人工确认后再处理）`);
  }

  console.log(APPLY ? "完成" : "以上是待办，未移动任何文件");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
