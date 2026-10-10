#!/usr/bin/env node
/**
 * 写入 5 条 WebUI 样本（需求/供给/情报），走与线上相同的 advance 流水线。
 * 用法：npm run db:up && npm run migrate && npm run seed:samples
 */
import pg from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBootstrapConfig } from "../apps/knot-platform/src/config.js";
import { advance } from "../apps/knot-platform/src/launch.js";
import { recordMessage } from "../apps/knot-platform/src/messages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLES = [
  {
    role: "demand",
    body: "需要深圳南山附近带独立卫生间的合租单间，预算每月三千左右，近地铁优先。",
    contact: "demand-nanshan@example.com",
  },
  {
    role: "supply",
    body: "南山科技园内有空余工位可短租，环境安静，可按天或按月，适合小团队过渡。",
    contact: "wechat: gongwei-nanshan",
  },
  {
    role: "intel",
    body: "前海片区下周有中小企业供需对接活动，详情见 https://example.com/sz-match-week",
    contact: "intel@example.com",
  },
  {
    role: "demand",
    body: "寻找熟悉 Golang 的后端开发外包，工期约两个月，负责现有微服务拆分与上线。",
    contact: "hr-golang@example.com",
  },
  {
    role: "supply",
    body: "团队可提供 Golang 微服务开发、容器化部署与运维支持，有多个政企项目交付经验。",
    contact: "wechat: golang-team",
  },
];

async function main() {
  const { databaseUrl } = loadBootstrapConfig();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  const pool = {
    query: (text, params) => client.query(text, params),
  };

  const created = [];
  for (const sample of SAMPLES) {
    const person = await pool.query(`INSERT INTO persons DEFAULT VALUES RETURNING id`);
    const personId = person.rows[0].id;
    const inserted = await pool.query(
      `INSERT INTO expressions (person_id, actor, door, role, body, contact)
       VALUES ($1, 'person', 'webui', $2, $3, $4)
       RETURNING id, role`,
      [personId, sample.role, sample.body, sample.contact]
    );
    const expressionId = inserted.rows[0].id;
    await recordMessage(pool, {
      personId,
      expressionId,
      door: "webui",
      direction: "out",
      body: sample.body,
    });
    await advance(pool, expressionId);
    created.push({ id: expressionId, role: sample.role });
  }

  await client.end();
  console.log("seed:samples ok — added 5 expressions:");
  for (const row of created) console.log(`  - ${row.role} ${row.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
