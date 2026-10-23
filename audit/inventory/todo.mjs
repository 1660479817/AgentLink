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
    const m = /^\|\s*(S\d+-\d+)\s*\|\s*(P[0-3])\s*\|/.exec(line);
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
const severityOverride = {
  "S32-01": "P1", // 公钥注入：机制属实但写入口是已审核的申请单，复核降为 P1
};

// 处理结论。除下面三类之外全部已修——35 片都已逐条复核过，所以默认值是 fixed。
// 例外必须逐个列，这样清单不会因为漏写一条而假装它已经修好。
//
// partial = 只做了一半；defer = 需要主机/架构/新交互，本轮不做；wontfix = 复核不成立。
const PARTIAL = {
  "S10-08": "zip 加密头不再整份转码；readFile 整份读入与 zipNames 同步扫描未改",
  "S10-12": "可见性口径已统一；附件口径（HAS_ATTACHMENT 等）语义不同，未合并",
  "S10-14": "补了 points/requests/market 用例；下载打包与计费的端到端用例仍缺",
  "S13-03": "/api/admin 约三十条端点仍无 HTTP 级覆盖",
  "S13-04": "删帖与警告已入事务；令牌换发要先落授权码文件，只能是补偿路径",
  "S16-04": "只在 README 约束「一个部署根一个站点」，按站点分槽位未做",
  "S21-07": "AppButton 的 to 分支补了禁用态；弹窗内分享/打赏仍是自有皮肤",
  "S21-10": "resize 监听改 ResizeObserver；首屏同步整份 JSON.parse 未改",
  "S21-12": "下载状态机已补测试；打赏弹窗仍未抽成可测模块",
  "S23-20": "reopen 的错误码已能读出；isSale 仍在前端复刻，等后端给字段",
  "S24-06": "整目录同步 + 部署前拦截越界 import；纯函数下沉未做",
  "S30-07": "写入顺序已统一；第二份写失败时未回滚第一份",
  "S30-15": "清单解析失败改为 fail-closed，但没有可注入路径，只做静态核对",
  "S33-06": "补了视图清洗用例；组件测试缺依赖",
  "S03-04": "凭据可走文件，但仍受 --base 支配",
};

const DEFERRED = {
  "S10-10": "无状态 HMAC 无法单独吊销，要新增凭据表或改短期+续期",
  "S21-09": "点赞没有前端入口，补键属新交互（产品取舍）",
  "S16-10": "管理与精算共用令牌与 OS 用户，拆分属部署架构决定",
  "S16-13": "缺「临时部署根 + 真 tar 包」的部署集成测试",
  "S28-07": "要把连接层钉在固定 IP，当前无依赖可用",
  "S29-05": "收窄权限需入口主机 sudoers 配合",
  "S29-08": "error 日志在 nginx 层无法脱敏 URI",
  "S29-14": "去掉内联脚本会超出该切片范围",
  "S08-16": "截断标记需后端回传字段",
  "S33-11": "删导出与挪母版影响面大",
  "S33-14": "根跳转页仅本地预览用",
  "S03-10": "白名单要改浏览器启动参数",
  "S05-03": "换二维码库要改渲染，风险大于收益",
};

const WONTFIX = {
  "S11-12": "本机管理令牌本身没有账号身份，actor_account_id 为空是设计",
  "S22-08": "顶栏搜索仍在渲染，样式不是死代码",
  "S05-05": "多版本共存无风险，仅记录",
};

const statusOf = (id) =>
  id in PARTIAL
    ? { status: "partial", note: PARTIAL[id] }
    : id in DEFERRED
      ? { status: "defer", note: DEFERRED[id] }
      : id in WONTFIX
        ? { status: "wontfix", note: WONTFIX[id] }
        : { status: "fixed", note: "" };

const unique = [...seen.values()].map((item) => ({
  ...item,
  severity: severityOverride[item.id] || item.severity,
  handled: statusOf(item.id),
}));

const count = (sev) => unique.filter((i) => i.severity === sev).length;
const byStatus = (status) => unique.filter((i) => i.handled.status === status);
const LABEL = { fixed: "已修", partial: "部分", defer: "暂缓", wontfix: "不成立" };

const bySlice = {};
for (const item of unique) bySlice[item.slice] = (bySlice[item.slice] || 0) + 1;

writeFileSync(path.join(AUDIT, "todo.json"), JSON.stringify(unique, null, 2));

const table = (list) =>
  list.length
    ? [
        "| ID | 级 | 结论 | 说明 |",
        "|---|---|---|---|",
        ...list.map(
          (i) => `| ${i.id} | ${i.severity} | ${LABEL[i.handled.status]} | ${i.handled.note} |`
        ),
      ]
    : ["（无）"];

const lines = [
  "# 待修清单",
  "",
  "由 `audit/inventory/todo.mjs` 从 35 片报告的表里抽取。**这是「全部修完」的核对基准**。",
  "",
  "| 项 | 数字 |",
  "|---|---|",
  `| 原始行数 | ${all.length} |`,
  `| 去重后 | **${unique.length}** |`,
  `| 已修 | ${byStatus("fixed").length} |`,
  `| 部分 | ${byStatus("partial").length} |`,
  `| 暂缓 | ${byStatus("defer").length} |`,
  `| 复核不成立 | ${byStatus("wontfix").length} |`,
  "",
  "级别分布（含已处理的，用来说明这批问题的形状）：",
  "",
  "| P0 | P1 | P2 | P3 |",
  "|---|---|---|---|",
  `| ${count("P0")} | ${count("P1")} | ${count("P2")} | ${count("P3")} |`,
  "",
  "## 没有完全收口的",
  "",
  "### 部分完成",
  "",
  ...table(byStatus("partial")),
  "",
  "### 暂缓（需要主机、架构决定或新产品交互）",
  "",
  ...table(byStatus("defer")),
  "",
  "### 复核不成立",
  "",
  ...table(byStatus("wontfix")),
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
    const mark = i.handled.status === "fixed" ? "x" : " ";
    return `| [${mark}] | ${i.id}${also} | ${i.severity} | \`${i.where.replace(/\|/g, "\\|")}\` | ${i.problem.replace(/\|/g, "\\|")} | ${LABEL[i.handled.status]} |`;
  }),
  "",
];
writeFileSync(path.join(AUDIT, "TODO.md"), lines.join("\n"));

console.log(`切片 ${Object.keys(bySlice).length} 片，原始 ${all.length} 行，去重后 ${unique.length} 条`);
console.log(
  `已修 ${byStatus("fixed").length} / 部分 ${byStatus("partial").length} / 暂缓 ${byStatus("defer").length} / 不成立 ${byStatus("wontfix").length}`
);
