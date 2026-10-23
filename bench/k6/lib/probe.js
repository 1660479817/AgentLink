import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

// 每个端点各记一对指标：ep_<name>_ms（耗时）与 ep_<name>_err（错误率）。
//
// 用独立指标而不是 tag 子指标，是因为 --summary-export 只稳定导出顶层指标；
// 报告要按端点列一张「并发 × p95」的表，不能指望从 tag 聚合里读出来。
export function probe(name) {
  const elapsed = new Trend(`ep_${name}_ms`, true);
  const errors = new Rate(`ep_${name}_err`);

  return {
    // 判定默认接受 2xx/3xx；要更严的调用方自己传 ok。
    record(res, ok = (r) => r.status >= 200 && r.status < 400) {
      elapsed.add(res.timings.duration);
      const passed = Boolean(ok(res));
      errors.add(!passed);
      check(res, { [name]: () => passed });
      return res;
    },
  };
}
