import { readFileSync } from "node:fs";
import path from "node:path";

// 指标名 → 人读的名字。k6 的指标名只能用小写字母、数字和下划线，报告里要还原成方法 + 路径。
export const ENDPOINT_LABELS = {
  index: "GET /",
  board: "GET /discover.json",
  session: "GET /api/web/session",
  home: "GET /api/web/home",
  feed: "GET /api/web/information",
  card: "GET /api/web/intel/:id",
  search: "GET /api/web/search",
  sponsors: "GET /api/web/sponsors",
  asset: "GET /assets/*",
  agent_profile: "GET /api/agent/profile",
  agent_notifications: "GET /api/agent/notifications",
  agent_feed: "GET /api/agent/information",
  agent_card: "GET /api/agent/intel/:id",
  agent_search: "GET /api/agent/search",
  agent_requests: "GET /api/agent/requests",
  write_publish: "POST /api/agent/intel",
  write_look: "POST /api/agent/intel/:id/look",
  write_delete: "DELETE /api/agent/intel/:id",
  write_upload: "POST /api/agent/uploads",
};

// 判定线。读接口 1s、写接口 2s、错误率 1%（写 2%）。
// 这不是「行业标准」，是这套部署的验收线；要改就改这里，别在报告里手写。
export const LIMITS = {
  readP95: 1000,
  writeP95: 2000,
  errorRate: 0.01,
  writeErrorRate: 0.02,
};

const scenarioName = { read: "访客读", agent: "Agent 读", write: "写" };

function ms(value) {
  return typeof value === "number" ? String(Math.round(value)) : "-";
}

function pct(value) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "-";
}

// 失败详情第一行是「退出码 N / 被信号 X 终止」，已经单独写过；
// markdown 列表里只补后面那句 stderr 摘要，全文在 summary.json 里。
function firstOtherLine(text, skip) {
  const lines = String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.find((line) => line !== skip) || "";
}

function table(headers, rows) {
  const line = `| ${headers.join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  return [line, sep, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
}

function targetSection(target) {
  if (!target) return [];
  const out = [];
  const tr = target.transport || {};
  const rows = [];

  rows.push(["主机", target.host + (target.isXknotSubdomain ? "" : "（不是 *.xknot.si 子域）")]);
  rows.push(["链路", `${tr.protocol || "?"} · ALPN ${tr.alpn || "-"}${tr.certDaysLeft != null ? ` · 证书剩 ${tr.certDaysLeft} 天` : ""}`]);
  if (tr.mainBundle) {
    rows.push([
      "主包",
      `${tr.mainBundle.path} · ${(tr.mainBundle.bytes / 1024).toFixed(0)}KB · 压缩 ${tr.gzip || "-"}${tr.mainBundle.immutable ? " · immutable" : ""}`,
    ]);
  }
  if (target.instance) {
    rows.push(["实例", `${target.instance.name} · ${target.instance.release || target.instance.version} · ${target.instance.commit}`]);
  }
  if (target.entry) {
    rows.push([
      "首页",
      `${target.entry.bytes}B · ${target.entry.title || "(无标题)"}${target.entry.hasStaticFallback ? " · 含 noscript 兜底" : ""}`,
    ]);
  }
  if (target.board) {
    rows.push([
      "快照",
      `${target.board.posts} 条 · ${target.board.withImages} 张带图 · ${target.board.withFiles} 条带附件 · ${target.board.authors} 位作者`,
    ]);
  }
  if (target.session) {
    rows.push([
      "会话",
      `品牌 ${target.session.brand || "-"} · 访客浏览 ${target.session.guestBrowsing} · 注册 ${target.session.registrationMode}`,
    ]);
  }
  if (target.agent) rows.push(["Agent", `${target.agent.displayName || "-"} · 积分 ${target.agent.points ?? "-"}`]);

  const caps = Object.entries(target.capabilities || {})
    .map(([k, v]) => `${k} ${v ? "✓" : "✗"}`)
    .join(" · ");
  if (caps) rows.push(["能力", caps]);

  out.push(table(["项", "探测结果"], rows));
  out.push("");
  for (const w of target.warnings || []) out.push(`> 注意：${w}`);
  if ((target.warnings || []).length) out.push("");
  return out;
}

export function render(result) {
  const { meta, runs } = result;
  const out = [];
  const scenarioOf = (name) => scenarioName[name] || name;
  const localTime = (iso) => new Date(iso).toLocaleString("sv-SE").slice(0, 16);
  const target = meta.target || {};

  out.push(`# 访问速度 · ${target.host || new URL(meta.base).host} · ${localTime(meta.startedAt)}`);
  out.push("");
  out.push(`- 测点：${meta.base}`);
  out.push(`- 压测机：${meta.machine}${meta.label ? ` · ${meta.label}` : ""}`);
  out.push(`- k6：${meta.k6} · 每档 ${meta.duration} · 档间冷却 ${meta.cooldown}s`);
  out.push(`- 测量脚本：${meta.git || "unknown"} · 开始 ${localTime(meta.startedAt)} · 结束 ${localTime(meta.finishedAt)}`);
  out.push("");
  out.push(
    "> 数字包含测压机到入口主机的公网路径。换一台压测机，数字会变；比较只能在同机、同站点、同数据量之间做。"
  );
  out.push("");

  out.push("## 站点");
  out.push("");
  out.push(...targetSection(meta.target));

  if (meta.identity) {
    const id = meta.identity;
    const webMode =
      id.mode === "cookie"
        ? `每 VU 一份 Cookie（${id.cookies} 份）`
        : id.mode === "xff"
          ? "每 VU 一个 X-Forwarded-For（仅直连源站或可信代理有效）"
          : "所有 VU 共享出口 IP";
    const agentMode =
      id.tokens > 1 ? `每 VU 一份授权码（${id.tokens} 份）` : id.tokens === 1 ? "所有 VU 共享一份授权码" : "未提供";
    out.push("## 身份");
    out.push("");
    out.push(`- 访客读：${webMode}`);
    out.push(`- Agent：${agentMode}`);
    if (id.warning) out.push(`- 注意：${id.warning}`);
    out.push("");
  }

  const failed = meta.failed || [];
  if (meta.skipped?.length || failed.length) {
    out.push("本轮未测：");
    out.push("");
    for (const s of meta.skipped || []) out.push(`- ${scenarioOf(s.scenario)}：${s.reason}`);
    // 跑失败的档也要列出来：少一列却不说明，看到的就是「5–50 全过」。
    for (const f of failed) {
      const how =
        f.reason || (f.status == null ? `被信号 ${f.signal || "未知"} 终止` : `退出码 ${f.status}`);
      const detail = firstOtherLine(f.detail, how);
      out.push(
        `- ${scenarioOf(f.scenario)} ${f.vus} 并发：k6 未跑成（${how}，${Math.round((f.elapsedMs || 0) / 1000)}s）${detail ? ` · ${detail}` : ""}`
      );
    }
    out.push("");
  }

  // ---- 总览 ----
  out.push("## 总览");
  out.push("");
  if (!runs.length) {
    out.push("本轮没有跑成任何场景。原因见上面「本轮未测」。");
    out.push("");
  }
  const overview = runs.map((r) => [
    String(r.vus),
    scenarioOf(r.scenario),
    String(r.requests ?? "-"),
    r.rps ? r.rps.toFixed(1) : "-",
    pct(r.errorRate),
    pct(r.throttleRate ?? 0),
    ms(r.overall.p50),
    ms(r.overall.p95),
    ms(r.overall.p99),
  ]);
  out.push(table(["并发", "场景", "请求数", "RPS", "错误率", "限流率", "p50", "p95", "p99"], overview));
  out.push("");

  // ---- 端点 × 并发 p95 ----
  for (const scenario of Array.from(new Set(runs.map((r) => r.scenario)))) {
    const subset = runs.filter((r) => r.scenario === scenario);
    const keys = Array.from(new Set(subset.flatMap((r) => Object.keys(r.endpoints)))).sort((a, b) =>
      (ENDPOINT_LABELS[a] || a).localeCompare(ENDPOINT_LABELS[b] || b)
    );
    if (!keys.length) continue;
    const cols = Array.from(new Set(subset.map((r) => r.vus))).sort((a, b) => a - b);
    const rows = keys.map((key) => {
      const cells = cols.map((vus) => {
        const run = subset.find((r) => r.vus === vus);
        const ep = run && run.endpoints[key];
        return ep ? ms(ep.p95) : "-";
      });
      return [ENDPOINT_LABELS[key] || key, ...cells];
    });
    out.push(`## ${scenarioOf(scenario)} · 各端点 p95（ms）`);
    out.push("");
    out.push(table(["端点", ...cols.map((c) => `${c} 并发`)], rows));
    out.push("");

    // 429 单列一张表：只在真的出现限流时才有，免得每份报告都多一张空表。
    const limited = subset.some((r) => Object.values(r.endpoints).some((ep) => (ep.throttleRate || 0) > 0));
    if (limited) {
      const limitedRows = keys.map((key) => {
        const cells = cols.map((vus) => {
          const run = subset.find((r) => r.vus === vus);
          const ep = run && run.endpoints[key];
          return ep && ep.throttleRate ? pct(ep.throttleRate) : "-";
        });
        return [ENDPOINT_LABELS[key] || key, ...cells];
      });
      out.push(`## ${scenarioOf(scenario)} · 各端点限流（429）`);
      out.push("");
      out.push(table(["端点", ...cols.map((c) => `${c} 并发`)], limitedRows));
      out.push("");
      out.push("429 是「同一身份超过站点配额」，不是服务错误；`-` 表示这一档没有限流。");
      out.push("");
    }
  }

  // ---- 写场景清理 ----
  // 这三条以前都只在 k6 里静默掉：解析不出 id、DELETE 失败、清理抛异常。
  // 报告里不给出一张表，读的人就只知道「跑完了」。
  const cleanupRuns = runs.filter((r) => r.cleanup);
  if (cleanupRuns.length) {
    const cleanupRows = cleanupRuns.map((r) => [
      String(r.vus),
      String(r.cleanup.created ?? "-"),
      String(r.cleanup.deleted ?? "-"),
      String(r.cleanup.leftover ?? "-"),
      pct(r.cleanup.errRate),
    ]);
    out.push("## 写场景清理");
    out.push("");
    out.push(table(["并发", "发布", "删除", "残留", "清理失败率"], cleanupRows));
    out.push("");
    out.push(
      "残留 = 发帖成功但没删掉的记录：intelId 解析不出、DELETE 未返回 `ok: true`（含 429）或清理抛异常。它们是不公开记录，不在信息流也不进快照，但仍在作者记录里。"
    );
    out.push("");
  }

  // ---- 超阈 ----
  const breaches = [];
  const noData = [];
  for (const run of runs) {
    const eps = Object.entries(run.endpoints || {});
    // 整档没有端点指标，和「每个端点都没样本」一样，不能算通过。
    if (!eps.length) {
      noData.push(`${scenarioOf(run.scenario)} ${run.vus} 并发 · 整档没有端点指标`);
      continue;
    }
    for (const [key, ep] of eps) {
      const write = key.startsWith("write_");
      const limit = write ? LIMITS.writeP95 : LIMITS.readP95;
      const errLimit = write ? LIMITS.writeErrorRate : LIMITS.errorRate;
      // 无样本（例如整档 100% 429）时 p95 是 null，而 `null > limit` 为 false，
      // 以前这一档就被判成「未超过验收线」。没有样本只能记「未取得数据」。
      if (!(ep.count > 0) || typeof ep.p95 !== "number") {
        noData.push(
          `${scenarioOf(run.scenario)} ${run.vus} 并发 · ${ENDPOINT_LABELS[key] || key} · 没有样本（请求 ${ep.requests ?? 0} 次，其中 429 ${ep.throttled || 0} 次）`
        );
        continue;
      }
      if (ep.p95 > limit) breaches.push(`${scenarioOf(run.scenario)} ${run.vus} 并发 · ${ENDPOINT_LABELS[key] || key} · p95 ${ms(ep.p95)}ms > ${limit}ms`);
      if (ep.errRate > errLimit) breaches.push(`${scenarioOf(run.scenario)} ${run.vus} 并发 · ${ENDPOINT_LABELS[key] || key} · 错误率 ${pct(ep.errRate)} > ${pct(errLimit)}`);
    }
  }
  out.push("## 判定");
  out.push("");
  if (noData.length) {
    out.push(`无结论：${noData.length} 项没有样本，不能当作通过。`);
    out.push("");
    for (const n of noData.slice(0, 40)) out.push(`- ${n}`);
    if (noData.length > 40) out.push(`- ……另有 ${noData.length - 40} 项，见 summary.json`);
    out.push("");
  }
  if (failed.length) {
    out.push(`结论不完整：${failed.length} 档 k6 未跑成（见「本轮未测」），这些并发数没有数据。`);
    out.push("");
  }
  const hasSamples = runs.some((r) => Object.values(r.endpoints || {}).some((ep) => ep.count > 0));
  if (!breaches.length) {
    if (noData.length || failed.length) {
      // 有缺口时不能单写「未超过验收线」：那会把「没测到」读成「通过了」。
      // 一个样本都没有时连「其余」也没有，这句话就不该出现。
      if (hasSamples) {
        out.push(`其余有样本的端点未超过验收线：读 p95 ≤ ${LIMITS.readP95}ms、写 p95 ≤ ${LIMITS.writeP95}ms、错误率 ≤ ${pct(LIMITS.errorRate)}；但上面列出的缺口没有数据。`);
      }
    } else {
      out.push(`未超过验收线：读 p95 ≤ ${LIMITS.readP95}ms、写 p95 ≤ ${LIMITS.writeP95}ms、错误率 ≤ ${pct(LIMITS.errorRate)}。`);
    }
    out.push("");
  } else {
    out.push(`超过验收线 ${breaches.length} 项：`);
    out.push("");
    for (const b of breaches.slice(0, 40)) out.push(`- ${b}`);
    if (breaches.length > 40) out.push(`- ……另有 ${breaches.length - 40} 项，见 summary.json`);
  }
  const leftoverTotal = runs.reduce((sum, r) => sum + (r.cleanup?.leftover || 0), 0);
  if (leftoverTotal) {
    out.push(`- 写场景有 ${leftoverTotal} 条记录没有删掉，见「写场景清理」；这一轮不是「零痕迹」。`);
  }
  const throttledTotal = runs.reduce((sum, r) => sum + (r.throttled || 0), 0);
  if (throttledTotal) {
    out.push(`- 另有 ${throttledTotal} 次 429 限流，已单列；不计入错误率，也不进入 p95。`);
  }
  // 缺数据时不能只看「未超过验收线」，把结论一句话再说一遍，方便只看结尾的人。
  if (noData.length || failed.length || leftoverTotal) {
    const gaps = [];
    if (noData.length) gaps.push(`${noData.length} 项无样本`);
    if (failed.length) gaps.push(`${failed.length} 档未跑成`);
    if (leftoverTotal) gaps.push(`${leftoverTotal} 条写记录未清理`);
    out.push("");
    out.push(`> 结论：本轮有 ${gaps.join("、")}，不能算完整通过。`);
  }
  out.push("");

  out.push("## 怎么读这张表");
  out.push("");
  out.push("- p95 是「一百次里有五次比它慢」。看它，不看平均。");
  out.push("- 并发升上去 p95 翻倍、错误率抬头：瓶颈在隧道或后端连接池，不在页面。");
  // 入口有两种投放：static 把页面放在入口主机磁盘上，proxy 连首页都回源到实例。
  // 同一行建议不能两边都写，否则整站反代的站会被误判成「入口磁盘慢」。
  if (target.capabilities?.staticEntry) {
    out.push("- 静态端点（`/`、`/discover.json`、`/assets/*`）由入口主机直接回，不穿隧道。它们慢，是入口或带宽的问题。");
  } else {
    out.push("- 这个站是整站反代：连 `/`、`/discover.json`、`/assets/*` 都穿隧道。它们慢，先看隧道与实例，不是入口磁盘。");
  }
  out.push("- `/api/*` 经隧道回实例；每个新建 TCP 都多一次跨洋往返，所以 keepalive 命中与否差别很大。");
  out.push(
    "- 429 是限流，不是服务错误：`ep_<name>_throttled` 单列，`ep_<name>_ms` 只统计未被限流的请求。要测容量上限，先让每个 VU 有自己的身份，或在该测试实例把对应配额调高。"
  );
  out.push("- 人那一层（`human/`）给的是单用户体感，不和这里的并发数混在一张表里。");
  out.push("");
  return out.join("\n");
}

if (process.argv[1] && process.argv[1].endsWith("report.mjs")) {
  const dir = path.resolve(process.argv[2] || "results");
  const file = dir.endsWith(".json") ? dir : path.join(dir, "summary.json");
  console.log(render(JSON.parse(readFileSync(file, "utf8"))));
}
