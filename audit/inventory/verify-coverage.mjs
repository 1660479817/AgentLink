#!/usr/bin/env node
// 覆盖核验：切片分配的每个文件，是否真的出现在该片报告的「已读清单」里。
// 这是「没有漏」这一主张的唯一证明方式。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";

const ROOT = process.cwd();
const SLICES = join(ROOT, "audit/inventory/slices");
const CODE = join(ROOT, "audit/code");

const results = [];
let totalFiles = 0;
let covered = 0;

for (const f of readdirSync(SLICES).filter((x) => x.endsWith(".tsv")).sort()) {
  const id = basename(f, ".tsv");
  const assigned = readFileSync(join(SLICES, f), "utf8")
    .split("\n")
    .map((l) => l.match(/^\d+\t\w+\t(.+)$/))
    .filter(Boolean)
    .map((m) => m[1]);

  const reportPath = join(CODE, `${id}.md`);
  const exists = existsSync(reportPath);
  const report = exists ? readFileSync(reportPath, "utf8") : "";

  const missing = assigned.filter((p) => !report.includes(p));
  totalFiles += assigned.length;
  covered += assigned.length - missing.length;
  results.push({ id, assigned: assigned.length, missing, exists });
}

console.log("片   分配  已读  缺失");
for (const r of results) {
  const flag = r.missing.length ? "  <-- 缺" : "";
  console.log(
    `${r.id}  ${String(r.assigned).padStart(3)}  ${String(r.assigned - r.missing.length).padStart(3)}  ${String(r.missing.length).padStart(3)}${flag}`
  );
  for (const m of r.missing) console.log(`        未在报告出现: ${m}`);
}

const noReport = results.filter((r) => !r.exists);
console.log(`\n合计：分配 ${totalFiles} 个文件，报告中出现 ${covered} 个，缺失 ${totalFiles - covered} 个`);
console.log(`报告文件：${results.length} 片，缺失报告 ${noReport.length} 片`);
