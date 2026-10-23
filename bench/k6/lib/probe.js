import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

// 每个端点各记一组指标：
//   ep_<name>_ms        没有被限流的请求耗时
//   ep_<name>_err       真正的错误率（4xx/5xx/网络错误），429 不算
//   ep_<name>_throttled 429 限流率，单独列出来
//
// 429 单列的原因：检索（以及其它有限流的端点）按「一个身份每分钟 N 次」算。
// 压测若共享一个出口 IP 或一个授权码，打到上限后整片 429；把它算进错误率，
// 会把「限流」误判成「后端不稳定或并发能力差」。429 也不是正常耗时，
// 混进 p95 会把延迟压低，所以只统计未被限流的请求。
//
// 用独立指标而不是 tag 子指标，是因为 --summary-export 只稳定导出顶层指标；
// 报告要按端点列一张「并发 × p95」的表，不能指望从 tag 聚合里读出来。

// 全体未被限流请求的耗时，报告用它出总览的 p50/p95/p99。
const servedMs = new Trend("served_ms", false);

export function probe(name) {
  const elapsed = new Trend(`ep_${name}_ms`, false);
  const errors = new Rate(`ep_${name}_err`);
  const throttled = new Rate(`ep_${name}_throttled`);

  return {
    // 判定默认只认 2xx。以前 3xx 也算通过：k6 默认跟随重定向，剩下的 301/304
    // 和「回 200 的维护页」一样会被记成成功，整张表就可能测的是另一个页面。
    // 需要更宽的调用方自己传 ok。
    record(res, ok = (r) => r.status >= 200 && r.status < 300) {
      const limited = res.status === 429;
      const passed = Boolean(ok(res));
      if (!limited) {
        elapsed.add(res.timings.duration);
        servedMs.add(res.timings.duration);
      }
      errors.add(!passed && !limited);
      throttled.add(limited);
      check(res, { [name]: () => passed });
      return res;
    },
  };
}
