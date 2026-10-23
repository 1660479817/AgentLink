// 把 k6 的 --summary-export 解析成报告用的形状。
//
// 429 的处理是这里的重点：ep_<name>_throttled 是限流率，既不算错误，也不算耗时。
// 旧结果没有这个指标，就按 0 处理，所以老报告还能照常渲染。

export function metricValues(metric) {
  return (metric && (metric.values || metric)) || {};
}

function countOf(rate) {
  const passes = Number(rate.passes);
  const fails = Number(rate.fails);
  return Number.isFinite(passes) && Number.isFinite(fails) ? passes + fails : null;
}

// Rate 的 passes 是 add(true) 的次数。旧版导出没有 passes 时，用 value × 总数回算。
function trueCount(rate) {
  const passes = Number(rate.passes);
  if (Number.isFinite(passes)) return passes;
  const total = countOf(rate) || 0;
  return Math.round((Number(rate.value) || 0) * total);
}

export function parseSummaryData(raw) {
  const metrics = raw.metrics || {};
  const endpoints = {};

  // 端点键从三组指标里取：某个端点如果全被 429，_ms 可能一条样本都没有。
  for (const name of Object.keys(metrics)) {
    const match = /^ep_(.+)_(?:ms|err|throttled)$/.exec(name);
    if (!match) continue;
    const key = match[1];
    if (endpoints[key]) continue;

    const ms = metricValues(metrics[`ep_${key}_ms`]);
    const err = metricValues(metrics[`ep_${key}_err`]);
    const thr = metricValues(metrics[`ep_${key}_throttled`]);
    const errTotal = countOf(err);
    const throttled = trueCount(thr);
    const served = ms.count ?? (errTotal == null ? 0 : Math.max(0, errTotal - throttled));

    endpoints[key] = {
      // count 只数没有被限流的请求，p95 才是用户实际等到的耗时。
      count: served,
      requests: errTotal ?? served + throttled,
      p50: ms.med ?? ms["p(50)"] ?? null,
      p95: ms["p(95)"] ?? null,
      p99: ms["p(99)"] ?? null,
      max: ms.max ?? null,
      errRate: err.value ?? err.rate ?? 0,
      errCount: trueCount(err),
      throttled,
      throttleRate: thr.value ?? thr.rate ?? 0,
    };
  }

  let errCount = 0;
  let servedCount = 0;
  let throttledCount = 0;
  for (const ep of Object.values(endpoints)) {
    errCount += ep.errCount || 0;
    servedCount += ep.count || 0;
    throttledCount += ep.throttled || 0;
  }

  const totals = metricValues(metrics.http_reqs);
  const requests = totals.count ?? Object.values(endpoints).reduce((sum, ep) => sum + (ep.requests || 0), 0);
  const servedDur = metricValues(metrics.served_ms);
  const dur = servedDur.count ? servedDur : metricValues(metrics.http_req_duration);

  // 写场景的清理结果。以前只有 k6 的 write_leftover 指标，summary 不读，
  // 报告就看不到「这一轮发布了几条、删掉几条、还剩几条」。
  const cleanupMetrics = ["write_cleanup_err", "write_created", "write_deleted", "write_leftover"];
  const hasCleanup = cleanupMetrics.some((name) => metrics[name]);
  const cleanupErr = metricValues(metrics.write_cleanup_err);
  const createdCount = metricValues(metrics.write_created).count ?? null;
  const deletedCount = metricValues(metrics.write_deleted).count ?? null;
  const leftoverCount = metricValues(metrics.write_leftover).count ?? null;
  const cleanup = hasCleanup
    ? {
        // write_cleanup_err 的分母是发帖成功数；一次失败都没有时 k6 不导出这条指标，
        // 只要发生过发布就记 0，别把「没有失败」显示成「没有数据」。
        errRate: cleanupErr.value ?? cleanupErr.rate ?? (createdCount > 0 ? 0 : null),
        errCount: trueCount(cleanupErr),
        created: createdCount,
        deleted: deletedCount,
        // write_leftover 只在有残留时出现；没有这条指标时用「发布 - 删除」补 0。
        leftover:
          leftoverCount ??
          (createdCount != null && deletedCount != null ? Math.max(0, createdCount - deletedCount) : null),
      }
    : null;

  return {
    requests,
    served: servedCount,
    throttled: throttledCount,
    rps: totals.rate ?? null,
    // 错误率按「没有被限流的请求」算；429 不是错误，见上方说明。
    // 一个请求都没被服务时记 null，不能记 0：0 会被读成「零错误」。
    errorRate: servedCount ? errCount / servedCount : null,
    throttleRate: requests ? throttledCount / requests : 0,
    overall: { p50: dur.med ?? null, p95: dur["p(95)"] ?? null, p99: dur["p(99)"] ?? null },
    endpoints,
    cleanup,
  };
}
