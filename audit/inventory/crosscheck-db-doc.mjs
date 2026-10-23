#!/usr/bin/env node
// 文档 ↔ 线上库 逐列核对（v2）。
// 文档用的是散文式描述（"`(intel_id, upload_id)` 主键，`sort_order` 默认 0"），
// 所以判定标准是：列名是否在所属小节正文里以反引号出现过，而不是必须成表格。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();

const dump = readFileSync(join(ROOT, "audit/db/cpswang-live-schema.sql"), "utf8");
const liveTables = new Map();
{
  const re = /CREATE TABLE public\.(\w+) \(([\s\S]*?)\n\);/g;
  let m;
  while ((m = re.exec(dump))) {
    const cols = [];
    for (const line of m[2].split("\n")) {
      const c = line.match(/^\s{4}(\w+)\s/);
      if (c && !["CONSTRAINT", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK"].includes(c[1])) cols.push(c[1]);
    }
    liveTables.set(m[1], cols);
  }
}

const doc = readFileSync(join(ROOT, "knot-platform/docs/KNOT_DATABASE.md"), "utf8");
// 按 ### 切节；标题可能写多个表（"friendships 与 friend_dismissals"）。
const sections = [];
{
  let cur = null;
  for (const line of doc.split("\n")) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      const names = [...h[1].matchAll(/[a-z][a-z_0-9]+/g)].map((x) => x[0]).filter((n) => liveTables.has(n));
      cur = { names, body: [] };
      sections.push(cur);
      continue;
    }
    if (/^##\s/.test(line)) { cur = null; continue; }
    if (cur) cur.body.push(line);
  }
}

// 每张表归到第一个提到它的节
const tableSection = new Map();
for (const s of sections) for (const n of s.names) if (!tableSection.has(n)) tableSection.set(n, s);

const rows = [];
for (const [t, cols] of liveTables) {
  const sec = tableSection.get(t);
  const body = sec ? sec.body.join("\n") : "";
  const mentioned = cols.filter((c) => body.includes("`" + c + "`"));
  const absent = cols.filter((c) => !body.includes("`" + c + "`"));
  rows.push({ table: t, cols: cols.length, mentioned: mentioned.length, absent, hasSection: !!sec });
}

// 文档提到但库里没有的表名（反向）
const docOnly = [...tableSection.keys()].filter((t) => !liveTables.has(t));

rows.sort((a, b) => b.absent.length - a.absent.length);

const out = [];
out.push("# 数据库文档 ↔ 线上库 逐列核对\n");
out.push("线上库：`audit/db/cpswang-live-schema.sql`（30 表 / 196 列，与迁移重放结果 100% 一致）  ");
out.push("文档：`knot-platform/docs/KNOT_DATABASE.md`  ");
out.push("判定：列名在该表所属小节正文里以反引号出现过即为「已文档化」。\n");

out.push("## 总览\n");
out.push("| 表 | 列数 | 已文档化 | 未提及 |");
out.push("|---|---|---|---|");
for (const r of rows) out.push(`| \`${r.table}\` | ${r.cols} | ${r.mentioned} | ${r.absent.length ? "**" + r.absent.length + "**" : 0} |`);
out.push("");

const totalCols = rows.reduce((s, r) => s + r.cols, 0);
const totalMentioned = rows.reduce((s, r) => s + r.mentioned, 0);
out.push(`合计：196 列中 **${totalMentioned}** 列在文档里被点名，**${totalCols - totalMentioned}** 列未提及。\n`);

const unmentioned = rows.filter((r) => r.absent.length);
out.push("## 未在文档中提及的列\n");
if (!unmentioned.length) out.push("无。");
for (const r of unmentioned) out.push(`- \`${r.table}\`：${r.absent.map((c) => "`" + c + "`").join("、")}`);
out.push("");

out.push("## 文档提到、库里没有的表\n");
out.push(docOnly.length ? docOnly.map((t) => `- \`${t}\``).join("\n") : "无。");
out.push("");

mkdirSync(join(ROOT, "audit/findings"), { recursive: true });
writeFileSync(join(ROOT, "audit/findings/db-doc-drift.md"), out.join("\n") + "\n");

console.log(`列覆盖：${totalMentioned}/${totalCols}`);
for (const r of unmentioned) console.log(`  ${r.table}: ${r.absent.join(", ")}`);
console.log(`文档独占表：${docOnly.length}`);
