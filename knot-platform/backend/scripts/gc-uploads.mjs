#!/usr/bin/env node
// 回收没有被引用的上传和派生件。默认只报告；加 --apply 才删。
//
//   set -a; source sites/<站点>/platform.env; set +a
//   node backend/scripts/gc-uploads.mjs                      # 报告
//   node backend/scripts/gc-uploads.mjs --apply              # 删行 + 删文件
//
// 只碰这几类：
//   1. uploads 行没有任何引用，且早于宽限期
//   2. blobs 里没有对应 uploads 行的文件，且早于宽限期
//   3. display / packets / extracts / shares 里已经没有对应主体的文件
//   4. tmp/ 里超过宽限期的半截文件
// 不碰 board/。
//
// 删行只发一条语句，并在同一条语句里再判一次引用：跑 GC 的同时有人把附件挂到帖子上，
// 这一行不会被删（uploads 被 intel_files 级联删除，删错就是连帖子一起少附件）。
// 文件在行删掉之后才移除；反过来一旦删库失败，就会留下「有行没文件」。
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";
import { DERIVED_KINDS, USED_UPLOADS_SQL, blobPath, blobsDir, derivedDir, keepDerivedFile } from "../src/storage.js";

const APPLY = process.argv.includes("--apply");
const graceArg = process.argv.find((arg) => arg.startsWith("--grace-hours="));
const GRACE_HOURS = Number(graceArg ? graceArg.split("=")[1] : process.env.KNOT_GC_GRACE_HOURS || 24);
if (!Number.isFinite(GRACE_HOURS) || GRACE_HOURS < 0) throw new Error("--grace-hours 要是非负数字");
const GRACE_MS = GRACE_HOURS * 3600 * 1000;

function human(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${n} B`;
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function stale(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs > GRACE_MS;
  } catch {
    return false;
  }
}

function remove(file) {
  if (!APPLY) return;
  fs.rmSync(file, { force: true });
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

// 只在目录已经空了的时候删它；非空的留着。
function pruneEmpty(dir) {
  if (!APPLY) return;
  try {
    if (fs.readdirSync(dir).length) return;
    fs.rmdirSync(dir);
  } catch {
    // 非空、已被删、或不是目录，都跳过。
  }
}

function pruneEmptyTree(dir) {
  if (!APPLY) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) pruneEmptyTree(path.join(dir, entry.name));
  }
  pruneEmpty(dir);
}

async function main() {
  const { databaseUrl, uploadDir } = loadBootstrapConfig();
  const root = path.resolve(uploadDir);
  if (!fs.existsSync(root)) throw new Error(`上传目录不存在：${root}`);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  console.log(`根 ${root}`);
  console.log(APPLY ? `模式：删除，宽限期 ${GRACE_HOURS} 小时` : `模式：只报告，宽限期 ${GRACE_HOURS} 小时`);

  const orphans = (
    await client.query(
      `WITH used AS (${USED_UPLOADS_SQL})
       SELECT u.id, u.storage_name, u.size, u.created_at
       FROM uploads u
       WHERE NOT EXISTS (SELECT 1 FROM used x WHERE x.id = u.id)
       ORDER BY u.created_at`
    )
  ).rows;
  const eligible = orphans.filter((row) => Date.now() - new Date(row.created_at).getTime() > GRACE_MS);
  const fresh = orphans.filter((row) => !eligible.some((old) => old.id === row.id));
  const eligibleBytes = eligible.reduce((sum, row) => sum + (Number(row.size) || 0), 0);

  let removedNames = [];
  if (APPLY && eligible.length) {
    // 先锁候选行再删。外键插入会拿 KEY SHARE，和 FOR UPDATE 冲突：
    //   - 正在插的引用：SKIP LOCKED 把这行留到下个月，不抢；
    //   - 锁住之后的新引用：插入会等 GC 提交，再因行不存在而失败，不会被级联悄悄删掉。
    await client.query("BEGIN");
    try {
      const locked = await client.query(
        `WITH used AS (${USED_UPLOADS_SQL})
         SELECT u.id
         FROM uploads u
         WHERE u.id = ANY($1::uuid[])
           AND NOT EXISTS (SELECT 1 FROM used x WHERE x.id = u.id)
         FOR UPDATE OF u SKIP LOCKED`,
        [eligible.map((row) => row.id)]
      );
      const ids = locked.rows.map((row) => row.id);
      if (ids.length) {
        const deleted = await client.query(
          `DELETE FROM uploads u WHERE u.id = ANY($1::uuid[]) RETURNING u.storage_name`,
          [ids]
        );
        removedNames = deleted.rows.map((row) => String(row.storage_name));
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  if (!APPLY) {
    console.log(
      `无引用行：${orphans.length} 行，可删 ${eligible.length} 行（${human(eligibleBytes)}），` +
        `宽限期内保留 ${fresh.length} 行`
    );
  } else {
    const raced = eligible.length - removedNames.length;
    console.log(
      `无引用行：已删 ${removedNames.length} 行，宽限期内保留 ${fresh.length} 行` +
        (raced > 0 ? `，${raced} 行在删除前刚被引用，留下` : "")
    );
  }

  // 行已经删掉，再动文件。
  let fileBytes = 0;
  let missingFiles = 0;
  for (const name of removedNames) {
    const files = [blobPath(root, name)];
    const present = files.filter((file) => fs.existsSync(file));
    if (!present.length) missingFiles += 1;
    for (const file of present) {
      fileBytes += sizeOf(file);
      remove(file);
    }
  }
  if (APPLY && removedNames.length) {
    console.log(`已删文件：${human(fileBytes)}${missingFiles ? `，${missingFiles} 行本来就没文件` : ""}`);
  }

  // 磁盘上有、库内没有的原件。
  const known = new Set(
    (await client.query(`SELECT storage_name FROM uploads`)).rows.map((row) =>
      path.basename(String(row.storage_name))
    )
  );
  const strayBlobs = walk(blobsDir(root)).filter((file) => !known.has(path.basename(file)) && stale(file));
  let strayBytes = 0;
  for (const file of strayBlobs) {
    strayBytes += sizeOf(file);
    remove(file);
  }
  console.log(`blobs 里没有库记录的文件：${strayBlobs.length} 个（${human(strayBytes)}）`);
  if (APPLY && strayBlobs.length) {
    for (const file of new Set(strayBlobs.map((entry) => path.dirname(entry)))) pruneEmptyTree(file);
  }

  // 根目录里不该有散落的原件（原件都收在 blobs/），扫出来清掉。
  const strayRoot = [];
  let strayRootBytes = 0;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (known.has(entry.name)) continue;
    const file = path.join(root, entry.name);
    if (!stale(file)) continue;
    strayRoot.push(file);
    strayRootBytes += sizeOf(file);
    remove(file);
  }
  console.log(`根目录里没有库记录的文件：${strayRoot.length} 个（${human(strayRootBytes)}）`);

  // 派生件：主体不在了就删。display 的文件名是 `<storage_name>.jpg`。
  const intelIds = new Set(
    (await client.query(`SELECT id FROM intel`)).rows.map((row) => String(row.id).toLowerCase())
  );
  const storageNames = new Set([...known].map((name) => name.toLowerCase()));

  const derivedReport = [];
  for (const kind of DERIVED_KINDS) {
    const dir = derivedDir(root, kind);
    const doomed = [];
    let bytes = 0;
    for (const file of walk(dir)) {
      // 判定与审计、测试共用一份（storage.keepDerivedFile），别在这里另写一套。
      const keep = keepDerivedFile(kind, path.relative(dir, file), storageNames, intelIds);
      if (keep || !stale(file)) continue;
      doomed.push(file);
      bytes += sizeOf(file);
      remove(file);
    }
    if (APPLY && doomed.length) {
      for (const dirName of new Set(doomed.map((entry) => path.dirname(entry)))) pruneEmptyTree(dirName);
    }
    derivedReport.push(`${kind} ${doomed.length} 个 / ${human(bytes)}`);
  }
  console.log(`派生件可删：${derivedReport.join("，")}`);

  // tmp 里超过宽限期的半截文件。
  const staleTmp = walk(path.join(root, "tmp")).filter(stale);
  let tmpBytes = 0;
  for (const file of staleTmp) {
    tmpBytes += sizeOf(file);
    remove(file);
  }
  if (staleTmp.length) console.log(`tmp 里超期的文件：${staleTmp.length} 个（${human(tmpBytes)}）`);

  await client.end();
  console.log(APPLY ? "完成" : "以上是待办，未删除任何东西");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
