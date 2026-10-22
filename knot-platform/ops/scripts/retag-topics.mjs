#!/usr/bin/env node
// 一次性整理：把历史记录的话题标签改成与正文同语种。
//
// 评审员（knot-intel）现在按正文语种写 topics，后端也会丢掉语种不符的标签。
// 在这之前写进库的记录可能留着旧标签：英文正文配「联邦网络」「内容枢纽」这种中文词。
// 这个脚本找出这些记录，请评审员按正文重出一次标签，只改 detail.topics，
// verdict、category、language 与 note 都不动。
//
// 用法（在部署根上跑；重复执行没有副作用，语种已一致的记录会跳过）：
//   node ops/scripts/retag-topics.mjs --site local --dry-run
//   node ops/scripts/retag-topics.mjs --site local
//   node ops/scripts/retag-topics.mjs --site bot01 --all       # 不看语种，全部重出
//   node ops/scripts/retag-topics.mjs --site local --limit 5
//
// 需要站点处于运行状态可用的配置：platform.env 里的 DATABASE_URL、UPLOAD_DIR
// 与 OPENCLAW_INTEL_AGENT。没有 platform.env 时退回 site.env（本地直跑源码）。

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "@knot/config";
import { topicMatchesLanguage } from "@knot/locale";
import pg from "pg";
import { retagIntelTopics } from "../../backend/src/market.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function arg(argv, name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  if (index < 0) return fallback;
  return argv[index + 1] ?? fallback;
}

function siteDir(argv, site) {
  const given = arg(argv, "dir");
  if (given) return path.resolve(given);
  const root = String(process.env.KNOT_DEPLOY_ROOT || "").trim();
  return path.join(root ? path.resolve(root) : ROOT, "sites", site);
}

/** 运行时配置优先，缺了才用部署前的 site.env。 */
function loadSiteEnv(dir, site) {
  const files = [path.join(dir, "site.env"), path.join(dir, "platform.env")].filter((file) => existsSync(file));
  if (!files.length) throw new Error(`site.env 与 platform.env 都不在 ${dir}`);
  const merged = {};
  for (const file of files) Object.assign(merged, parseEnv(readFileSync(file, "utf8")));
  // shell 里显式给的值优先，方便临时指向另一套库。
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in process.env)) process.env[key] = value;
  }
  if (!process.env.KNOT_SITE) process.env.KNOT_SITE = site;
  return files;
}

function mismatch(topics, language) {
  return topics.filter((topic) => !topicMatchesLanguage(topic, language));
}

async function main(argv) {
  const site = arg(argv, "site", process.env.KNOT_SITE || "local");
  const dryRun = argv.includes("--dry-run");
  const all = argv.includes("--all");
  const limit = Number(arg(argv, "limit", "0")) || 0;

  const dir = siteDir(argv, site);
  const files = loadSiteEnv(dir, site);
  if (!process.env.DATABASE_URL) throw new Error("没有 DATABASE_URL：检查 platform.env");
  if (!process.env.OPENCLAW_INTEL_AGENT) throw new Error("没有 OPENCLAW_INTEL_AGENT：这个实例没有配评审员");

  console.log(`站点 ${site}（${files.join("、")}）${dryRun ? "· 只打印，不写库" : ""}`);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows } = await pool.query(
      `SELECT id, detail FROM intel
       WHERE detail ? 'topics' AND jsonb_typeof(detail -> 'topics') = 'array'
         AND jsonb_array_length(detail -> 'topics') > 0
       ORDER BY created_at ASC`
    );
    const targets = rows
      .map((row) => {
        const topics = Array.isArray(row.detail?.topics) ? row.detail.topics : [];
        const language = typeof row.detail?.language === "string" ? row.detail.language : "";
        return { id: row.id, language, topics, bad: mismatch(topics, language) };
      })
      .filter((row) => all || row.bad.length > 0);
    const picked = limit > 0 ? targets.slice(0, limit) : targets;

    if (!picked.length) {
      console.log(`没有需要整理的记录（检查了 ${rows.length} 条带标签的记录）。`);
      return 0;
    }
    console.log(`需要整理 ${targets.length} 条${limit ? `，本次处理 ${picked.length} 条` : ""}。`);

    let failed = 0;
    for (const [index, row] of picked.entries()) {
      const head = `[${index + 1}/${picked.length}] ${row.id} · ${row.language || "und"}`;
      console.log(`${head}  before: ${JSON.stringify(row.topics)}`);
      if (dryRun) continue;
      try {
        const result = await retagIntelTopics(pool, row.id);
        console.log(`${head}  after:  ${JSON.stringify(result?.topics ?? [])}`);
      } catch (error) {
        failed += 1;
        console.log(`${head}  失败：${error?.message || error}`);
      }
    }
    if (failed) console.log(`${failed} 条没整理成功，修好后重跑即可（已改过的会跳过）。`);
    return failed ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error?.message || error);
    process.exit(1);
  });
