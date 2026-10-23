import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");
const argv = process.argv.slice(2);
const STATUS_ONLY = argv.includes("--status");
// 整库重建会清空数据。只有明确要求时才做，绝不在普通部署里顺手清库。
const ALLOW_RESET = argv.includes("--reset") || /^(1|true|yes|on)$/i.test(process.env.KNOT_ALLOW_SCHEMA_RESET || "");

function hash(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

async function resetSchema(client) {
  console.warn("==> 按 --reset 重建 public schema（账号、内容、积分全部清空）");
  await client.query("DROP SCHEMA IF EXISTS public CASCADE");
  await client.query("CREATE SCHEMA public");
}

async function main() {
  const { databaseUrl } = loadBootstrapConfig();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  const present = await client.query(
    `SELECT to_regclass('public.accounts') AS accounts,
            to_regclass('public.users') AS users,
            to_regclass('public.expressions') AS expressions`
  );
  const marker = present.rows[0] || {};
  // accounts 是当前基线；users / expressions 是更早的结构（含把 Agent 塞进 users 的那一版）。
  const legacy = Boolean(marker.users || marker.expressions) && !marker.accounts;
  if (ALLOW_RESET) {
    // --reset 就是「这份代码不认库里的旧结构，整库按基线重来」。库里记录着的旧迁移名
    // 也一并清掉，否则下面那道 stale 检查会把人堵在一个 --reset 也解不开的循环里。
    await resetSchema(client);
  } else if (legacy) {
    await client.end();
    console.error(
      "这个库用的是旧结构（users / expressions），不能原地升级。\n" +
        "重建会清空账号与内容，所以默认不动。\n" +
        "确认要清空并重建：node backend/scripts/migrate.js --reset\n" +
        "想先备份：./ops/scripts/backup-knot.sh"
    );
    process.exit(1);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT
    )
  `);
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");

  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Map(
    (await client.query("SELECT name, checksum FROM schema_migrations")).rows.map((row) => [row.name, row.checksum])
  );

  // 里程碑：基线合并了上一代的增量补丁。库记着上一代那一组迁移时，结构已经和新基线
  // 同一代，只差记录——在新的基线上重放一遍（整份都是 IF NOT EXISTS / 守卫块），
  // 通过就改写记录，不重建库、不动数据。不在其中，返回 false，交回下面的常规流程。
  const known = new Set(files);
  const baselineFile = files[0] || "";
  const baselineSum = baselineFile ? hash(fs.readFileSync(path.join(migrationsDir, baselineFile), "utf8")) : "";

  // 上一代的迁移组合。只认这几组：它们产出的结构和新基线逐项一致。
  const PREVIOUS_MILESTONES = [
    ["001_accounts.sql"],
    ["001_accounts.sql", "002_search_index.sql"],
    ["001_accounts.sql", "002_search_index.sql", "003_agent_type.sql"],
  ];

  // 这个库是不是「停在上一代、需要接纳」，是就返回那一组迁移名。
  function pendingMilestone() {
    const appliedNames = [...applied.keys()].sort();
    if (!appliedNames.length || !baselineFile) return null;
    const sameSet = (set) => set.length === appliedNames.length && set.every((name, i) => name === appliedNames[i]);
    const previous = PREVIOUS_MILESTONES.find(sameSet);
    if (!previous) return null;
    const stale = appliedNames.filter((name) => !known.has(name));
    const drift = applied.has(baselineFile) && applied.get(baselineFile) !== baselineSum;
    return stale.length || drift ? previous : null;
  }

  async function adoptMilestone(previous) {
    const baselineSql = fs.readFileSync(path.join(migrationsDir, baselineFile), "utf8");
    console.log(`==> 接纳里程碑：${previous.join(" + ")} → ${baselineFile}`);
    await client.query("BEGIN");
    try {
      // 重放基线。已有对象全部跳过，缺的列、索引、约束补上。
      await client.query(baselineSql);
      await client.query("DELETE FROM schema_migrations");
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [baselineFile, baselineSum]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(
        `里程碑接纳失败，库没有改动：${error.message}\n` +
          "结构已经不是上一代基线产出的那一份。确认可以清空重建后再跑：node backend/scripts/migrate.js --reset"
      );
      process.exit(1);
    }
    applied.clear();
    applied.set(baselineFile, baselineSum);
  }

  const milestone = pendingMilestone();
  if (milestone && !STATUS_ONLY) await adoptMilestone(milestone);

  // 库里记着这份代码没有的迁移，说明库比代码旧或旧。基线名没变时更要拦住。
  const stale = [...applied.keys()].filter((name) => !known.has(name));
  // --status 只是报告：停在上一代里程碑的库本来就会命中这一支，不能当成错误。
  if (stale.length && !(STATUS_ONLY && milestone)) {
    await client.end();
    console.error(
      `schema_migrations 里有当前代码没有的迁移：${stale.join("、")}\n` +
        `这份代码的迁移是 ${files.join("、")}。旧库请重建：node backend/scripts/migrate.js --reset`
    );
    process.exit(1);
  }

  const pending = [];
  const drifted = [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const sum = hash(sql);
    if (!applied.has(file)) {
      pending.push({ file, sql, sum });
      continue;
    }
    // 已执行的迁移被改过：库里的结构和这份代码对不上，必须让人看见。
    const recorded = applied.get(file);
    if (recorded && recorded !== sum) {
      drifted.push(file);
      continue;
    }
    if (!recorded && !STATUS_ONLY) {
      await client.query("UPDATE schema_migrations SET checksum = $2 WHERE name = $1", [file, sum]);
    }
  }

  if (STATUS_ONLY) {
    console.log(`已执行 ${applied.size} 个，待执行 ${pending.length} 个。`);
    if (milestone) console.log(`  可接纳里程碑：${milestone.join(" + ")} → ${baselineFile}（跑一次迁移即可，不重建）`);
    if (drifted.length) console.log(`  基线内容变了：${drifted.join("、")}`);
    try {
      const { rows } = await client.query("SELECT version FROM schema_milestone");
      if (rows.length) console.log(`里程碑 ${rows[0].version}`);
    } catch {
      /* 老库还没有这张表 */
    }
    for (const item of pending) console.log(`  待执行 ${item.file}`);
    await client.end();
    return;
  }

  if (drifted.length) {
    await client.end();
    console.error(
      `迁移文件被改过：${drifted.join("、")}\n已执行的是另一份内容。基线只能整库重建：--reset`
    );
    process.exit(1);
  }

  for (const { file, sql, sum } of pending) {
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [file, sum]);
      await client.query("COMMIT");
      console.log("applied", file);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
