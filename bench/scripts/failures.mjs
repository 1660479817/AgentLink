// 一档 k6 没跑成时的记账。
//
// run.mjs 一运行就要探测站点、起 k6 进程，测试里 import 不了，所以把「怎么记」
// 和「退出码怎么定」抽到这里：失败档只打在控制台，报告和调用方都会把它当成跑过了。

// 把 runK6 的失败结果整理成 meta.failed 里的一条。
// reason 用来覆盖「退出码」的说法：k6 退出码 0 但没写导出文件时，讲退出码会误导。
export function failureRecord({ scenario, vus, elapsedMs, status, signal, error, reason, tail }) {
  const how = reason
    ? reason
    : error
      ? `启动失败：${error.message || error}`
      : status == null
        ? `被信号 ${signal || "未知"} 终止`
        : `退出码 ${status}`;
  return {
    scenario,
    vus,
    status: status ?? null,
    signal: signal || "",
    elapsedMs: elapsedMs || 0,
    // 报告直接用它写「为什么没跑成」：退出码 0 但没导出文件时，只讲退出码会误导。
    reason: how,
    detail: [how, String(tail || "").trim()].filter(Boolean).join("\n"),
  };
}

// 有档位没跑成时退出码必须是 1。仍是 0 的话，CI 和调用脚本会把残缺的一轮当「全过」。
export function exitCodeFor(meta) {
  return meta && meta.failed && meta.failed.length ? 1 : 0;
}
