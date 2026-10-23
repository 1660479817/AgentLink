// 把 35 片报告里的发现表抽成一张可核对的清单。
//
// 「全部修完」这句话只有在能逐条勾选时才有意义：这个脚本产出 audit/TODO.md
// 与 audit/todo.json，前者给人看，后者给后续批量修复跑进度。
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const AUDIT = path.dirname(DIR);
const CODE = path.join(AUDIT, "code");

// 一行一条发现：| ID | P级 | 位置 | 维度 | 问题 | 证据 | 修复 | 置信度 |
function rows(text, file) {
  const out = [];
  for (const line of text.split("\n")) {
    const m = /^\|\s*(S\d+-\d+)\s*\|\s*(P[0-3])\s*\|(.*)$/.exec(line);
    if (!m) continue;
    const cells = line.split("|").map((c) => c.trim());
    // ["", id, sev, where, dim, problem, evidence, fix, confidence, ""]
    out.push({
      id: cells[1],
      severity: cells[2],
      where: cells[3] || "",
      dimension: cells[4] || "",
      problem: cells[5] || "",
      evidence: cells[6] || "",
      fix: cells[7] || "",
      confidence: cells[8] || "",
      slice: file.replace(/\.md$/, ""),
    });
  }
  return out;
}

const all = [];
for (const file of readdirSync(CODE).filter((f) => f.endsWith(".md")).sort()) {
  all.push(...rows(readFileSync(path.join(CODE, file), "utf8"), file));
}

// 同一问题常被多片各报一次（交叉引用）。按「问题原文」去重，保留第一个 ID，
// 其余记进 alsoReported，免得清单上重复计数。
const seen = new Map();
for (const item of all) {
  const key = item.problem.slice(0, 80);
  if (seen.has(key)) seen.get(key).alsoReported.push(item.id);
  else seen.set(key, { ...item, alsoReported: [] });
}

// 复核结论会改级别：切片表是初查，findings 正文才是定稿。
// 不在这里对齐，清单会拿 P0 去收一个已经降级的问题。
const SEVERITY_OVERRIDE = {
  "S32-01": "P1", // 机制属实，但写入口是已完成审核的申请单，降为 P1
};

// 已处理完的条目。status: fixed = 改了代码；wontfix = 判断为不需要改，理由必须写。
// 这张表是「全部完成」的唯一凭据：清单上每条要么有 commit，要么有一句理由。
const HANDLED = {
  "S14-01": { status: "fixed", note: "uploadStore.js 归一 MIME 并拒收 text/html，323c29c" },
  "S32-01": { status: "fixed", note: "validate.mjs 单行公钥校验，app/store/provision 三处共用" },
  "S10-02": { status: "fixed", note: "查重改认 pending/passed + 分区唯一索引，撤下后可原样重发" },
  "S04-01": { status: "fixed", note: "同 S10-02；文档承诺的幂等现在覆盖 pending" },
  "S16-02": { status: "fixed", note: "抽 lib/lock.sh，backup 与 openclaw 同步各一把锁" },
  "S17-04": { status: "fixed", note: "reset-knot.sh 失败时 trap 拉起 Backend" },
  "S11-03": { status: "fixed", note: "pool.on(error) 兜底空闲连接中断" },
  "S18-01": { status: "fixed", note: "zip 条目数/单条/总量三道上限，323c29c" },
  "S18-03": { status: "fixed", note: "块引用深度上限 32 + 溢出截断 2000 字" },
  "S19-02": { status: "fixed", note: "formatValue 只放行 $HOME，其余 $ 与元字符加引号转义" },
  "S03-01": { status: "fixed", note: "k6 失败档进「本轮未测」，整轮判定为结论不完整" },
  "S03-02": { status: "fixed", note: "无样本不再判通过，判定写明没有样本" },
  "S03-03": { status: "fixed", note: "发布/删除/残留/清理失败率写进报告" },
  "S08-01": { status: "fixed", note: "管理端写操作请求期禁用 + 同表单去重，错误落卡片内" },
  "S08-02": { status: "fixed", note: "截断如实标注「只列出最近 N 条」，文案不含写死的 30/200" },
  "S10-01": { status: "fixed", note: "六位密钥已接 LOGIN_MAX_FAILURES/LOGIN_LOCK_MS，323c29c" },
  "S11-01": { status: "fixed", note: "撤下按 COALESCE(origin_id,id) 整条修订链处置" },
  "S11-02": { status: "fixed", note: "查在岗行→换码收进同一事务与咨询锁" },
  "S16-01": { status: "fixed", note: "BUILD.json 发布名白名单，323c29c" },
  "S17-01": { status: "fixed", note: "重建前先 pg_dump 转存 knot_keep，并加 --recover 回灌" },
  "S17-02": { status: "fixed", note: "入口推送改用远端 mktemp 一次性目录" },
  "S18-02": { status: "fixed", note: "xlsx 列号与每行格数收到 16384，越界整格丢弃" },
  "S19-01": { status: "wontfix", note: "复核不成立：KNOT_DB_MODE 在 SITE_KEYS，checkSite 读得到，实跑会报错退出" },
  "S20-01": { status: "fixed", note: "site-config 加 knot_require_entry_paths，拒空值/相对路径/共用缺省值" },
  "S25-01": { status: "fixed", note: "申请列表失败渲染错误条 + 重试，并按分类隔离旧行" },
  "S26-01": { status: "fixed", note: "同 S25-01，同一根因一次改完" },
  "S28-01": { status: "fixed", note: "deploy-api 先备份再落盘，nginx -t 失败回滚" },
  "S28-02": { status: "fixed", note: "deploy-hub 目标目录护栏 + --delete 前打印删除清单" },
  "S30-01": { status: "fixed", note: "跨成员校验错误不再被过滤，只放行「改前就有」的旧错" },
  "S30-02": { status: "fixed", note: "markActive 只允许 pending→active，suspended/retired 不动" },
  "S30-03": { status: "fixed", note: "端口分配排除本轮已占用，并按名册重算而非永久失败" },
  "S30-04": { status: "fixed", note: "rotateRelayToken 同事务签新吊销旧" },
  "S32-02": { status: "fixed", note: "一次性令牌校验申请状态 + 原子核销" },
  "S32-03": { status: "fixed", note: "状态迁移带前态守卫，写库与事件同一事务" },
};

const unique = [...seen.values()].map((item) => ({
  ...item,
  severity: SEVERITY_OVERRIDE[item.id] || item.severity,
  handled: HANDLED[item.id] || null,
}));

const count = (sev) => unique.filter((i) => i.severity === sev && !i.handled).length;
const done = unique.filter((i) => i.handled).length;


const bySlice = {};
for (const item of unique) bySlice[item.slice] = (bySlice[item.slice] || 0) + 1;

writeFileSync(path.join(AUDIT, "todo.json"), JSON.stringify(unique, null, 2));

const lines = [
  "# 待修清单",
  "",
  "由 `audit/inventory/todo.mjs` 从 35 片报告的表里抽取。**这是「全部修完」的核对基准**：",
  "一条一行，修完打 `x` 并写上处理方式（修 / 不修 + 理由）。",
  "",
  "| 项 | 数字 |",
  "|---|---|",
  `| 原始行数 | ${all.length} |`,
  `| 去重后 | **${unique.length}** |`,
  `| 已处理 | ${done} |`,
  `| 待处理 | ${unique.length - done} |`,
  `| 待处理 P0 | ${count("P0")} |`,
  `| 待处理 P1 | ${count("P1")} |`,
  `| 待处理 P2 | ${count("P2")} |`,
  `| 待处理 P3 | ${count("P3")} |`,
  "",
  "## 已处理",
  "",
  "| ID | 处理方式 | 说明 |",
  "|---|---|---|",
  ...unique
    .filter((i) => i.handled)
    .map((i) => `| ${i.id} | ${i.handled.status === "fixed" ? "已修" : "不改"} | ${i.handled.note} |`),
  "",
  "## 按片分布",
  "",
  "| 片 | 条数 |",
  "|---|---|",
  ...Object.entries(bySlice).sort().map(([s, n]) => `| ${s} | ${n} |`),
  "",
  "## 清单",
  "",
  "| 勾选 | ID | 级 | 位置 | 问题 | 处理 |",
  "|---|---|---|---|---|---|",
  ...unique.map((i) => {
    const also = i.alsoReported.length ? `<br>另见 ${i.alsoReported.join("、")}` : "";
    const mark = i.handled ? "x" : " ";
    const how = i.handled ? (i.handled.status === "fixed" ? "已修" : "不改") : "";
    return `| [${mark}] | ${i.id}${also} | ${i.severity} | \`${i.where.replace(/\|/g, "\\|")}\` | ${i.problem.replace(/\|/g, "\\|")} | ${how} |`;
  }),
  "",
];
writeFileSync(path.join(AUDIT, "TODO.md"), lines.join("\n"));
console.log(`切片 ${Object.keys(bySlice).length} 片，原始 ${all.length} 行，去重后 ${unique.length} 条`);
console.log(`已处理 ${done}，待处理 ${unique.length - done}`);
console.log(`待处理 P0 ${count("P0")} / P1 ${count("P1")} / P2 ${count("P2")} / P3 ${count("P3")}`);
