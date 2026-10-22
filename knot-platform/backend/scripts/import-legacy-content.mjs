#!/usr/bin/env node
// 把 0.3.x / 0.4.x 的内容搬进 accounts 结构的库（0.5.0 起的唯一基线）。
//
// 0.4 之前的库把人和 Agent 都放在 users 里，内容按 user_id 归属；0.5 只有一张
// accounts 表，内容按 account_id 归属。两边差的就是一列名字，所以这份脚本做四件事：
//
//   1. 核对来源是旧结构（users）、目标是新结构（accounts），账号 id 一个都不能缺；
//   2. 按依赖顺序把内容搬过去，user_id → account_id，作者身份原样保留
//      （Agent 发的帖子仍署名那个 Agent，不改成它的主人）；
//   3. 只对「收件箱」和「账本」做钱包归并：通知与积分流水按
//      COALESCE(owner_id, id) 归到账号，和运行时写新行的方式一致；
//   4. 报一张逐表对账单，并在一个事务里完成——中途失败不会留下半套内容。
//
// 两个库是两份连接，所以一条 INSERT … SELECT 走不通：这里从来源读出、分批写目标。
//
// 不搬的东西：sessions、login_keys、sponsors、system_policy、economy_policy、
// price_proposals。这些在 reset-knot.sh 重建时已经按原样留下，或本来就该按当前
// 实例重新决定。余额也不动：重建时 Agent 的余额已经并回主人，这里再动会翻倍。
//
// 用法（在读得到 platform.env 的部署根里跑）：
//
//   set -a; source sites/<站点>/platform.env; set +a
//   node backend/scripts/import-legacy-content.mjs --from postgres://…/knot_legacy [--dry-run]
//
// 旧库从备份还原出来只用于读取，例如：
//   createdb knot_legacy && pg_restore -d knot_legacy --no-owner <备份>/knot.dump
//
// 上传文件不在这里搬：先按备份把 UPLOAD_DIR 放回去，搬完库再跑
// `node backend/scripts/migrate-storage-layout.mjs --apply`。重启 Backend 会重写
// 公开快照（bindDiscoverBoard 启动时就排一次写入）。
import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";

// 旧列名 → 新列名。其余列两边同名。
const RENAME = { user_id: "account_id", actor_id: "actor_account_id" };

// 按外键依赖排序：被引用的在前。
//   uploads 先于头像回填与 intel_files；
//   intel 自引用两列（responds_to / origin_id）先留空，最后统一补；
//   invite_redemptions 引用 invite_codes 与 accounts；
//   retrieval_jobs 引用 intel。
const COPY_ORDER = [
  "invite_codes",
  "uploads",
  "intel",
  "intel_files",
  "intel_stars",
  "intel_likes",
  "intel_dismissals",
  "packet_downloads",
  "request_unlocks",
  "request_looks",
  "intel_reads",
  "intel_mentions",
  "search_events",
  "intel_tips",
  "notifications",
  "point_ledger",
  "friendships",
  "friend_dismissals",
  "admin_actions",
  "invite_redemptions",
  "retrieval_jobs",
];

// 收件箱与账本按钱包落库：Agent 名下的通知与流水都算主人的。
// 内容表不在此列——帖子、附件、点赞仍然是那个身份自己的。
const WALLET_TABLES = new Set(["notifications", "point_ledger"]);

// intel 的两条自引用外键不能随行一起插入，顺序不保证被引用的那一行已经在了。
const DEFERRED_INTEL_COLUMNS = ["responds_to", "origin_id"];

// 一行一条 INSERT 太碎，Postgres 的参数上限是 65535，200 行足够稳。
const BATCH_ROWS = 200;

/** 旧库是不是 users 结构；新库是不是 accounts 结构。 */
export function detectSchema(present) {
  return {
    source: present.sourceUsers ? "legacy" : present.sourceAccounts ? "accounts" : "unknown",
    target: present.targetAccounts ? "accounts" : "unknown",
  };
}

/** 从来源读一张表，列名在 SELECT 里就改成新名字。 */
export function buildSelectSql({ table, columns }) {
  const select = columns.map((column) => {
    const source = column === "account_id" ? "user_id" : column === "actor_account_id" ? "actor_id" : column;
    return `"${source}" AS "${column}"`;
  });
  return `SELECT ${select.join(", ")} FROM public."${table}"`;
}

/** 分批写目标；主键或唯一键撞上就跳过，重复执行不会翻倍。 */
export function buildInsertSql({ table, columns, rowCount }) {
  if (!rowCount) return null;
  let index = 1;
  const tuples = [];
  for (let row = 0; row < rowCount; row += 1) {
    tuples.push(`(${columns.map(() => `$${index++}`).join(", ")})`);
  }
  return `INSERT INTO public."${table}" (${columns.map((column) => `"${column}"`).join(", ")})
VALUES ${tuples.join(", ")}
ON CONFLICT DO NOTHING`;
}

/** 整表插完之后，把 intel 的自引用列补上。 */
export function buildDeferredSql({ table, deferred, rowCount }) {
  if (!deferred.length || !rowCount) return null;
  const columns = ["id", ...deferred];
  let index = 1;
  const tuples = [];
  for (let row = 0; row < rowCount; row += 1) {
    tuples.push(`(${columns.map((column) => (column === "id" ? `$${index++}::uuid` : `$${index++}::uuid`)).join(", ")})`);
  }
  return `UPDATE public."${table}" AS t
SET ${deferred.map((column) => `"${column}" = v."${column}"`).join(", ")}
FROM (VALUES ${tuples.join(", ")}) AS v(${columns.map((column) => `"${column}"`).join(", ")})
WHERE t.id = v.id
  AND (${deferred.map((column) => `v."${column}" IS NOT NULL`).join(" OR ")})`;
}

async function columnsOf(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return rows;
}

// jsonb 列读回来已经是解析好的值；写回去时必须再序列化一次。
// 标量字符串是个坑：库里的 `"abc"` 读成 JS 字符串 abc，直接当参数发回去是
// 非法 JSON（少了引号），Postgres 会报 invalid input syntax for type json。
export function encodeValue(value, { json = false } = {}) {
  if (value === null || value === undefined) return null;
  return json ? JSON.stringify(value) : value;
}

async function countOf(client, table) {
  try {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM public."${table}"`);
    return Number(rows[0]?.n) || 0;
  } catch {
    return null;
  }
}

function chunk(rows, size) {
  const out = [];
  for (let start = 0; start < rows.length; start += size) out.push(rows.slice(start, start + size));
  return out;
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

async function main() {
  const argv = process.argv.slice(2);
  const DRY_RUN = argv.includes("--dry-run");
  const from = argValue(argv, "--from") || process.env.KNOT_LEGACY_DATABASE_URL;
  if (!from || from.startsWith("--")) {
    console.error("用法：node backend/scripts/import-legacy-content.mjs --from <旧库连接串> [--dry-run]");
    process.exit(2);
  }

  const { databaseUrl } = loadBootstrapConfig();
  const source = new pg.Client({ connectionString: from });
  const target = new pg.Client({ connectionString: databaseUrl });
  await source.connect();
  await target.connect();

  try {
    const present = await source.query(
      `SELECT to_regclass('public.users') AS "sourceUsers",
              to_regclass('public.accounts') AS "sourceAccounts"`
    );
    const targetPresent = await target.query(`SELECT to_regclass('public.accounts') AS "targetAccounts"`);
    const schema = detectSchema({ ...present.rows[0], ...targetPresent.rows[0] });
    if (schema.source !== "legacy") {
      throw new Error(
        schema.source === "accounts"
          ? "来源已经是 accounts 结构，不需要再搬。"
          : "来源里既没有 users 也没有 accounts，连接串指错了库？"
      );
    }
    if (schema.target !== "accounts") {
      throw new Error("目标库还没有 accounts 表，先跑 backend/scripts/migrate.js。");
    }

    // 账号 id 是唯一的桥：旧库的每一行内容都挂在某个 id 上，目标库必须认得。
    const sourceIds = (await source.query(`SELECT id FROM public.users`)).rows.map((row) => row.id);
    const wallets = new Map(
      (await target.query(`SELECT id, COALESCE(owner_id, id) AS wallet FROM accounts`)).rows.map((row) => [
        row.id,
        row.wallet,
      ])
    );
    const missing = sourceIds.filter((id) => !wallets.has(id));
    if (missing.length) {
      throw new Error(
        `目标库缺少 ${missing.length} 个账号，内容会撞外键：\n  ${missing.slice(0, 10).join("\n  ")}` +
          (missing.length > 10 ? `\n  …共 ${missing.length} 个` : "") +
          "\n先用 reset-knot.sh 把账号搬过来，再跑这份脚本。"
      );
    }
    console.log(`来源 ${sourceIds.length} 个账号，目标库都认得。`);

    const report = [];
    await target.query("BEGIN");
    try {
      for (const table of COPY_ORDER) {
        const sourceColumns = await columnsOf(source, table);
        const targetColumns = await columnsOf(target, table);
        if (!sourceColumns.length || !targetColumns.length) {
          console.log(`跳过 ${table}：${sourceColumns.length ? "目标库" : "来源"}没有这张表`);
          continue;
        }
        const targetTypes = new Map(targetColumns.map((column) => [column.column_name, column.data_type]));
        // 只搬两边都有的列，改名之后比较。
        const columns = sourceColumns
          .map((column) => RENAME[column.column_name] || column.column_name)
          .filter((column) => targetTypes.has(column));
        const jsonColumns = new Set(
          columns.filter((column) => ["json", "jsonb"].includes(targetTypes.get(column)))
        );
        const deferred = table === "intel" ? DEFERRED_INTEL_COLUMNS : [];
        const copyColumns = columns.filter((column) => !deferred.includes(column));
        if (!copyColumns.length) continue;

        try {
          const { rows } = await source.query(buildSelectSql({ table, columns: copyColumns }));
          if (WALLET_TABLES.has(table)) {
            // 收件箱与账本跟着钱包走；运行时的写入也是这么落的。
            for (const row of rows) row.account_id = wallets.get(row.account_id) || row.account_id;
          }

          const before = await countOf(target, table);
          for (const part of chunk(rows, BATCH_ROWS)) {
            const values = part.flatMap((row) =>
              copyColumns.map((column) => encodeValue(row[column], { json: jsonColumns.has(column) }))
            );
            await target.query(buildInsertSql({ table, columns: copyColumns, rowCount: part.length }), values);
          }

          // intel 的自引用列：整表在位之后再补，UPDATE 时外键才找得到被引用的行。
          if (deferred.length) {
            const refs = await source.query(
              `SELECT id, ${deferred.map((column) => `"${column}"`).join(", ")} FROM public."${table}"
                WHERE ${deferred.map((column) => `"${column}" IS NOT NULL`).join(" OR ")}`
            );
            const deferredRows = refs.rows.filter((row) => row.id);
            for (const part of chunk(deferredRows, BATCH_ROWS)) {
              const values = part.flatMap((row) => [row.id, ...deferred.map((column) => row[column])]);
              await target.query(buildDeferredSql({ table, deferred, rowCount: part.length }), values);
            }          }

          const after = await countOf(target, table);
          const sourceCount = await countOf(source, table);
          report.push({ table, source: sourceCount, inserted: after - before, total: after });
        } catch (error) {
          error.message = `表 ${table}：${error.message}`;
          throw error;
        }
      }

      // 余额与流水：重建时余额已经并好，这里只核对，不改。
      const balance = await target.query(
        `SELECT COALESCE(SUM(points_balance), 0)::bigint AS balances,
                (SELECT COALESCE(SUM(delta), 0)::bigint FROM point_ledger) AS ledger
           FROM accounts`
      );
      const balances = Number(balance.rows[0].balances);
      const ledger = Number(balance.rows[0].ledger);

      console.log("\n逐表对账（来源 → 本次新增 → 现有）");
      for (const row of report) {
        const extra = row.total === row.source ? "" : `  ← 现有比来源多 ${row.total - row.source}`;
        console.log(
          `  ${row.table.padEnd(20)} ${String(row.source).padStart(5)} → ${String(row.inserted).padStart(5)} → ${String(row.total).padStart(5)}${extra}`
        );
      }
      console.log(`\n余额合计 ${balances}，流水合计 ${ledger}。`);
      if (balances !== ledger) {
        console.log("  两者不等是历史遗留（早于流水表的发放、打赏等）。余额是账，流水只是记录，不要拿流水覆盖余额。");
      }

      if (DRY_RUN) {
        await target.query("ROLLBACK");
        console.log("\ndry-run：全部回滚，目标库没有改动。");
      } else {
        await target.query("COMMIT");
        console.log("\n已提交。下一步：放回上传文件，再跑 migrate-storage-layout --apply，然后重启 Backend。");
      }
    } catch (error) {
      await target.query("ROLLBACK");
      throw error;
    }
  } finally {
    await source.end();
    await target.end();
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}
