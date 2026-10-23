#!/usr/bin/env node
// 里程碑清理：永久删除已经下架的内容行。默认只报告；加 --apply 才删。
//
//   set -a; source sites/<站点>/platform.env; set +a
//   node backend/scripts/purge-intel.mjs                     # 报告
//   node backend/scripts/purge-intel.mjs --apply             # 删行
//   node backend/scripts/purge-intel.mjs --verdict=rejected --apply
//
// 只删 `verdict = 'removed'`（或 --verdict 指定的终态）。这些行本来就不可见，
// 留着只是占空间、让每条查询多扫一批死行。
//
// 有三条安全线：
//   1. 还有活着的行引用它（修订 lineage 的 origin_id、wish 回应链的 responds_to）就整批不删，
//      先报告是哪几条。级联删会把别人的修订链扯断。
//   2. admin_actions 只把 intel_id 置空，不删审计行：删帖这件事发生过，得留下。
//   3. 附件行随 intel 级联删掉，但磁盘上的文件不在这里删——之后跑 gc-uploads.mjs --apply
//      统一回收，它按引用集合判断，不会误删别人正在用的文件。

import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";

const APPLY = process.argv.includes("--apply");
const VERSION = process.argv.find((arg) => arg.startsWith("--verdict="))?.split("=")[1] || "removed";
if (!["removed", "rejected"].includes(VERSION)) {
  throw new Error("--verdict 只接受 removed / rejected");
}

const { databaseUrl } = loadBootstrapConfig();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const { rows: countRows } = await client.query(`SELECT count(*)::int AS n FROM intel WHERE verdict = $1`, [VERSION]);
const total = countRows[0]?.n || 0;

const { rows: blockers } = await client.query(
  `SELECT 'origin_id' AS via, i.id AS alive_id, g.id AS gone_id
     FROM intel i JOIN intel g ON i.origin_id = g.id
    WHERE g.verdict = $1 AND i.verdict <> $1
   UNION ALL
   SELECT 'responds_to', i.id, g.id
     FROM intel i JOIN intel g ON i.responds_to = g.id
    WHERE g.verdict = $1 AND i.verdict <> $1
   LIMIT 20`,
  [VERSION]
);

console.log(`终态 ${VERSION} 的内容行：${total}`);
if (blockers.length) {
  console.log("仍有活着的行引用这些内容，整批不删：");
  for (const row of blockers) console.log(`   ${row.via}: ${row.alive_id} → ${row.gone_id}`);
  await client.end();
  process.exit(1);
}
if (!total) {
  await client.end();
  process.exit(0);
}
if (!APPLY) {
  const { rows: files } = await client.query(
    `SELECT count(*)::int AS n FROM intel_files f JOIN intel i ON i.id = f.intel_id WHERE i.verdict = $1`,
    [VERSION]
  );
  console.log(`可删附件行：${files[0]?.n || 0}（磁盘文件随后由 gc-uploads.mjs --apply 回收）`);
  console.log("加 --apply 执行。");
  await client.end();
  process.exit(0);
}

await client.query("BEGIN");
try {
  const ids = `SELECT id FROM intel WHERE verdict = $1`;
  // 审计行保留，只断开指向被删内容的那个字段。
  const admin = await client.query(
    `UPDATE admin_actions SET intel_id = NULL WHERE intel_id IN (${ids})`,
    [VERSION]
  );
  // 检索任务留在队列历史里，但不再指向被删的回应。
  const jobs = await client.query(
    `UPDATE retrieval_jobs SET respond_id = NULL WHERE respond_id IN (${ids})`,
    [VERSION]
  );
  const gone = await client.query(`DELETE FROM intel WHERE verdict = $1`, [VERSION]);
  await client.query("COMMIT");
  console.log(`删除 ${gone.rowCount} 行；断开审计 ${admin.rowCount} 条、检索任务 ${jobs.rowCount} 条。`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
}

await client.query("VACUUM ANALYZE intel");
await client.end();
console.log("完成。接着跑 gc-uploads.mjs --apply 回收不再被引用的文件。");
