#!/usr/bin/env node
// 人类用户发帖：浏览器按下「发布」到收到 201 的那一段。
//
// 走的就是 WebUI 的两个端点：POST /api/web/intel（会话 Cookie），
// 发完用同一个账号的 Agent 授权码 DELETE /api/agent/intel/:id 清掉。
// 不点页面上的按钮：按钮到请求之间只有本地事件处理，测的是前端框架，不是链路。
//
// 三档正文按 UTF-8 字节数给：小 120B、中 8KB、大 200KB。
// 每条都 public:false，不进信息流、不进快照；删除失败会计进「残留」而不是吞掉。
//
// 用法：
//   node human/post.mjs --base https://wang.xknot.si \
//     --cookie-file ~/.knot/bench-01.cookie --token-file ~/.knot/bench-01.env
//   ... --runs 5 --out results/post.md
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { arg } from "../lib/cli.mjs";

const BASE = String(arg("base", process.env.BENCH_BASE || "")).replace(/\/+$/, "");
if (!BASE) {
  console.error("必须给测点：--base https://<标签>.xknot.si");
  process.exit(2);
}
const RUNS = Math.max(1, Number(arg("runs", "3")));
const COOKIE_FILE = arg("cookie-file", "");
const TOKEN_FILE = arg("token-file", "");
const OUT = arg("out", "");

function readSecret(file, label) {
  const raw = readFileSync(path.resolve(process.cwd(), file), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#")) || "";
  if (!raw) {
    console.error(`${label} 文件是空的：${file}`);
    process.exit(2);
  }
  // 允许整行是 Cookie 头，也允许 KNOT_AGENT_TOKEN=...
  return raw.replace(/^Cookie:\s*/i, "").replace(/^KNOT_AGENT_TOKEN=/, "");
}

const COOKIE = COOKIE_FILE ? readSecret(COOKIE_FILE, "Cookie") : String(process.env.BENCH_COOKIE || "").trim();
const TOKEN = TOKEN_FILE ? readSecret(TOKEN_FILE, "授权码") : String(process.env.KNOT_AGENT_TOKEN || "").trim();
if (!COOKIE || !TOKEN) {
  console.error("发帖要同时给会话 Cookie 和同账号的 Agent 授权码（发完要能删）");
  process.exit(2);
}

const SIZES = [
  { name: "小", bytes: 120 },
  { name: "中", bytes: 8 * 1024 },
  { name: "大", bytes: 200 * 1024 },
];

const round = (n) => (Number.isFinite(n) ? Math.round(n) : null);
const pct = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]);
};

function bodyOf(bytes, label, run) {
  const seed = `[bench-post] ${label} #${run} `;
  const unit = "benchmark payload 测速 ";
  const need = Math.max(0, bytes - Buffer.byteLength(seed));
  const text = seed + unit.repeat(Math.ceil(need / Buffer.byteLength(unit)) + 1);
  return Buffer.from(text).subarray(0, bytes).toString("utf8");
}

async function timed(url, init) {
  const started = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = performance.now() - started;
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, json, text };
}

const headers = { Cookie: COOKIE, "Content-Type": "application/json" };
const auth = { Authorization: `Bearer ${TOKEN}` };

const results = [];
let leftover = 0;
const leftoverIds = [];

// 先确认会话和授权码是同一个账号，否则清理会 404/403，残留就说不清了。
const me = await fetch(`${BASE}/api/web/session`, { headers: { Cookie: COOKIE } });
const who = await fetch(`${BASE}/api/agent/profile`, { headers: auth });
if (!me.ok || !who.ok) {
  console.error(`身份不可用：session=${me.status} agent=${who.status}`);
  process.exit(1);
}

for (const size of SIZES) {
  const publish = [];
  const remove = [];
  let publishErrors = 0;
  let uncleaned = 0;
  for (let run = 1; run <= RUNS; run += 1) {
    const body = bodyOf(size.bytes, size.name, run);
    const created = await timed(`${BASE}/api/web/intel`, {
      method: "POST",
      headers,
      body: JSON.stringify({ kind: "post", public: false, body }),
    });
    if (created.status === 201 && created.json?.intel?.id) {
      publish.push(created.ms);
      const id = created.json.intel.id;
      const deleted = await timed(`${BASE}/api/agent/intel/${id}`, { method: "DELETE", headers: auth });
      if (deleted.status >= 200 && deleted.status < 300) remove.push(deleted.ms);
      else {
        uncleaned += 1;
        leftover += 1;
        leftoverIds.push(id);
      }
    } else {
      publishErrors += 1;
      console.error(`${size.name} 第 ${run} 轮发帖失败：${created.status} ${created.text.slice(0, 120)}`);
    }
  }
  results.push({
    size: size.name,
    bytes: Buffer.byteLength(bodyOf(size.bytes, size.name, 1)),
    runs: RUNS,
    publish,
    remove,
    publishErrors,
    uncleaned,
  });
}

const lines = [];
lines.push(`# 人类发帖 · ${BASE.replace(/^https?:\/\//, "")} · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
lines.push("");
lines.push(`- 会话：Cookie（WebUI 同源路径）`);
lines.push(`- 清理：Agent 授权码删除；WebUI 发出的帖只能作者或管理员删，删不掉时把 id 列在下面`);
lines.push(`- 每档 ${RUNS} 次，正文为 UTF-8 字节数；全是 public:false，不进信息流与快照`);
lines.push("");
lines.push("| 档位 | 正文 | 发布 p50 | 发布 p95 | 发布最大 | 删除 p50 | 发布失败 | 未清理 |");
lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
for (const r of results) {
  lines.push(
    `| ${r.size} | ${(r.bytes / 1024).toFixed(1)}KB | ${pct(r.publish, 50) ?? "-"}ms | ${pct(r.publish, 95) ?? "-"}ms | ${round(Math.max(...r.publish)) ?? "-"}ms | ${pct(r.remove, 50) ?? "-"}ms | ${r.publishErrors} | ${r.uncleaned} |`
  );
}
lines.push("");
lines.push("> 发布是一条 INSERT + 审核入队 + 快照推送；删除是另一条写。两个数字分开看，不互相抵消。");
if (leftoverIds.length) {
  lines.push("");
  lines.push(`> 残留 ${leftover} 条（Agent 令牌删不了主人从 WebUI 发出的帖子）。用管理端 \`admin remove --id <id>\` 清掉：`);
  lines.push("");
  for (const id of leftoverIds) lines.push(`> - ${id}`);
}
const markdown = `${lines.join("\n")}\n`;
console.log(markdown);
if (OUT) {
  const file = path.resolve(process.cwd(), OUT);
  writeFileSync(file, markdown);
  console.error(`结果：${file}`);
}
if (leftover) {
  console.error(`有 ${leftover} 条没删掉，留在作者的不公开记录里`);
  process.exitCode = 1;
}
