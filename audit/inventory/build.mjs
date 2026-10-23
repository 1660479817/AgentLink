#!/usr/bin/env node
// 审计清单与切片生成器。
// 目的：让「每个跟踪文件都被分配到一个切片」可以在构造上被证明，
// 而不是依赖人的记忆。改完重跑，再跑 --verify。
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "audit", "inventory");
const SLICES = join(OUT, "slices");

// 每个切片的目标行数。太大子代理读不完，太小浪费轮次。
const TARGET_LINES = 7000;
// 单个文件超过这个行数就独占一个切片，避免压垮一个切片。
const HEAVY_FILE = 1200;

const GENERATED = /^(knot-platform|xknot\.si|bench)\/package-lock\.json$|\.min\.(js|css)$/;
const BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pdf)$/i;
const ASSET = /^docs\/|^knot-platform\/web\/public\/|^xknot\.si\/web\/public\//;

function lsFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function lineCount(abs) {
  try {
    const buf = readFileSync(abs);
    if (buf.includes(0)) return [0, buf.length, true]; // 二进制
    let n = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] === 10) n++;
    return [n + (buf.length && buf[buf.length - 1] !== 10 ? 1 : 0), buf.length, false];
  } catch {
    return [0, 0, false];
  }
}

// 切片分组：同一目录的相邻文件放一起，读起来有上下文。
function areaOf(p) {
  const parts = p.split("/");
  if (parts.length === 1) return "(root)";
  if (parts[0] === "knot-platform" || parts[0] === "xknot.si") {
    if (["backend", "web", "admin", "ops", "docs", "packages", "server", "sites"].includes(parts[1])) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }
  return parts[0];
}

const files = lsFiles().map((p) => {
  const abs = join(ROOT, p);
  const [lines, bytes, binary] = lineCount(abs);
  const ext = extname(p).slice(1) || "-";
  return {
    path: p,
    area: areaOf(p),
    ext,
    lines,
    bytes,
    kind: GENERATED.test(p) ? "generated" : binary ? "binary" : ASSET.test(p) ? "asset" : "source",
  };
});

files.sort((a, b) => a.area.localeCompare(b.area) || a.path.localeCompare(b.path));

// ---- 清单 ----
const header = ["path", "area", "kind", "ext", "lines", "bytes", "slice", "status", "note"];
const manifest = [header.join("\t")];
for (const f of files) manifest.push([f.path, f.area, f.kind, f.ext, f.lines, f.bytes, "", "todo", ""].join("\t"));
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "manifest.tsv"), manifest.join("\n") + "\n");

// ---- 切片 ----
rmSync(SLICES, { recursive: true, force: true });
mkdirSync(SLICES, { recursive: true });

const heavy = files.filter((f) => f.lines >= HEAVY_FILE);
const rest = files.filter((f) => f.lines < HEAVY_FILE);

const buckets = [];
let cur = null;
const push = (f) => {
  if (!cur || cur.area !== f.area || (cur.lines + f.lines > TARGET_LINES && cur.files.length)) {
    cur = { area: f.area, lines: 0, files: [] };
    buckets.push(cur);
  }
  cur.files.push(f);
  cur.lines += f.lines;
};

let lastArea = null;
for (const f of rest) {
  if (f.area !== lastArea) lastArea = f.area;
  push(f);
}
for (const f of heavy) {
  buckets.push({ area: f.area, lines: f.lines, files: [f], heavy: true });
}

buckets.sort((a, b) => a.area.localeCompare(b.area) || b.lines - a.lines);

const sliceMeta = [];
buckets.forEach((b, i) => {
  const id = `S${String(i + 1).padStart(2, "0")}`;
  const body = [
    `# ${id} — ${b.area}${b.heavy ? "（单个重文件）" : ""}`,
    `# ${b.files.length} 个文件, ${b.lines} 行`,
    `# 输出：audit/code/${id}.md`,
    "",
    ...b.files.map((f) => `${f.lines}\t${f.kind}\t${f.path}`),
  ];
  writeFileSync(join(SLICES, `${id}.tsv`), body.join("\n") + "\n");
  sliceMeta.push({ id, area: b.area, files: b.files.length, lines: b.lines, heavy: !!b.heavy });
});

const totalLines = files.reduce((s, f) => s + f.lines, 0);
const byKind = files.reduce((m, f) => ((m[f.kind] = (m[f.kind] || 0) + 1), m), {});
writeFileSync(
  join(OUT, "summary.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim(),
      files: files.length,
      lines: totalLines,
      byKind,
      slices: sliceMeta,
    },
    null,
    2
  ) + "\n"
);

console.log(`manifest: ${files.length} files, ${totalLines} lines`);
console.log(`kinds: ${JSON.stringify(byKind)}`);
console.log(`slices: ${sliceMeta.length}`);
for (const s of sliceMeta) console.log(`  ${s.id} ${String(s.files).padStart(3)}f ${String(s.lines).padStart(6)}L  ${s.area}`);

// ---- 自检：切片并集必须等于清单 ----
if (process.argv.includes("--verify")) {
  const assigned = new Set();
  for (const s of sliceMeta) {
    const txt = readFileSync(join(SLICES, `${s.id}.tsv`), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\d+\t\w+\t(.+)$/);
      if (m) assigned.add(m[1]);
    }
  }
  const missing = files.filter((f) => !assigned.has(f.path));
  const extra = [...assigned].filter((p) => !files.some((f) => f.path === p));
  console.log(`\nverify: assigned=${assigned.size} manifest=${files.length} missing=${missing.length} extra=${extra.length}`);
  if (missing.length) console.log("MISSING:\n" + missing.map((f) => f.path).join("\n"));
  if (extra.length) console.log("EXTRA:\n" + extra.join("\n"));
  process.exit(missing.length || extra.length ? 1 : 0);
}
