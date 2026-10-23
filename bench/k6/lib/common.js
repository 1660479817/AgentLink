// 三个 k6 脚本共用的取数与选项。
//
// 黑箱：测点只从 BASE 来，不给任何站的默认值。忘了传就当场报错，
// 免得某次「忘了加 --base」把数字悄悄算到默认那个站头上。

export function baseUrl() {
  const base = String(__ENV.BASE || "").trim().replace(/\/+$/, "");
  if (!base) throw new Error("缺少 BASE：k6 run --env BASE=https://<标签>.xknot.si");
  if (!/^https?:\/\//.test(base)) throw new Error(`BASE 要从 http:// 或 https:// 起头：${base}`);
  return base;
}

export function vus() {
  return Math.max(1, Number(__ENV.VUS || 10));
}

export function duration() {
  return String(__ENV.DURATION || "30s");
}

// 场景脚本的 options 只写这三项：稳态并发、时长、优雅停止。
// 阈值不在这里设，由 scripts/report.mjs 的 LIMITS 统一判定。
export function options() {
  return {
    summaryTrendStats: ["avg", "min", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
    scenarios: {
      load: {
        executor: "constant-vus",
        vus: vus(),
        duration: duration(),
        gracefulStop: "10s",
      },
    },
  };
}

// k6 的 JS 引擎没有 DOM，静态资源地址只能从 index.html 里抠。
export function assetPaths(html) {
  const seen = new Set();
  const re = /["'](\/assets\/[A-Za-z0-9._-]+\.(?:js|css))["']/g;
  let m;
  while ((m = re.exec(html || "")) !== null) seen.add(m[1]);
  return Array.from(seen);
}
