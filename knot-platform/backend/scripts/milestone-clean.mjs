#!/usr/bin/env node
// 里程碑的数据层清理：删掉那些「过期就没有意义」的行，默认只报告。
//
//   set -a; source sites/<站点>/platform.env; set +a
//   node backend/scripts/milestone-clean.mjs            # 报告
//   node backend/scripts/milestone-clean.mjs --apply    # 删行并 VACUUM ANALYZE
//
// 只碰这三类，都是时间到了就失效、不再有任何读取方的行：
//   1. sessions        已经过期的会话
//   2. login_keys      用过超过宽限期的一次性登录钥匙，以及过期超过宽限期的
//   3. search_events   超出 KNOT_SEARCH_EVENT_RETENTION_DAYS 的检索打点（0 表示永久保留）
//
// 不碰：账号、内容、积分流水、管理操作、通知、好友与打赏。那些是业务历史，
// 删了会对不上账，不是「负担」。
//
// 没引用的 uploads 行和磁盘文件不在这里清：用 backend/scripts/gc-uploads.mjs，
// 它按引用集合判断，能同时删行和删文件，并且带宽限期。

import pg from "pg";
import { loadBootstrapConfig } from "../src/config.js";

const APPLY = process.argv.includes("--apply");
// 一次性钥匙用完之后留一周，够排查「这封邮件什么时候被用过」。
const KEY_GRACE_DAYS = 7;

const { databaseUrl } = loadBootstrapConfig();
const RETENTION_DAYS = Number(process.env.KNOT_SEARCH_EVENT_RETENTION_DAYS ?? 90);

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

const JOBS = [
  {
    name: "过期会话",
    count: `SELECT count(*)::int AS n FROM sessions WHERE expires_at < now()`,
    sql: `DELETE FROM sessions WHERE expires_at < now()`,
  },
  {
    name: `已用过的登录钥匙（超过 ${KEY_GRACE_DAYS} 天）`,
    count: `SELECT count(*)::int AS n FROM login_keys
            WHERE used_at IS NOT NULL AND used_at < now() - interval '${KEY_GRACE_DAYS} days'`,
    sql: `DELETE FROM login_keys
          WHERE used_at IS NOT NULL AND used_at < now() - interval '${KEY_GRACE_DAYS} days'`,
  },
  {
    name: `过期未用的登录钥匙（超过 ${KEY_GRACE_DAYS} 天）`,
    count: `SELECT count(*)::int AS n FROM login_keys
            WHERE used_at IS NULL AND expires_at < now() - interval '${KEY_GRACE_DAYS} days'`,
    sql: `DELETE FROM login_keys
          WHERE used_at IS NULL AND expires_at < now() - interval '${KEY_GRACE_DAYS} days'`,
  },
];

if (RETENTION_DAYS > 0) {
  JOBS.push({
    name: `检索打点（保留 ${RETENTION_DAYS} 天）`,
    count: `SELECT count(*)::int AS n FROM search_events
            WHERE created_at < now() - interval '${RETENTION_DAYS} days'`,
    sql: `DELETE FROM search_events
          WHERE created_at < now() - interval '${RETENTION_DAYS} days'`,
  });
}

let total = 0;
for (const job of JOBS) {
  const { rows } = await client.query(job.count);
  const n = rows[0]?.n || 0;
  total += n;
  if (!n) {
    console.log(`   ${job.name}：0`);
    continue;
  }
  if (!APPLY) {
    console.log(`   可删 ${job.name}：${n}（--apply 才删）`);
    continue;
  }
  const result = await client.query(job.sql);
  console.log(`   删 ${job.name}：${result.rowCount}`);
}

if (APPLY) {
  // 删完把空间收回去，顺手更新统计信息，免得计划器还按旧的死行估代价。
  for (const table of ["sessions", "login_keys", "search_events"]) {
    await client.query(`VACUUM ANALYZE ${table}`);
  }
}

await client.end();
console.log(
  APPLY
    ? `完成：删除 ${total} 行。`
    : `合计可删 ${total} 行。加 --apply 执行。`
);
