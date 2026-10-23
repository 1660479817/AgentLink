import { check } from "k6";
import { Rate, Trend } from "k6/metrics";

// 每个端点各记一组指标：
//   ep_<name>_ms        没有被限流的请求耗时
//   ep_<name>_err       真正的错误率（4xx/5xx/网络错误/响应体不符），429 不算
//   ep_<name>_throttled 429 限流率，单独列出来
//   ep_<name>_bad_body  状态 2xx 但响应体不是预期形状的次数，是 _err 的子集
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

// 成功不能只看状态码。200 也可能是 SPA 兜底页、入口维护页，或者 {"error": …}：
// 只判 2xx 时这些都算通过，报告会拿一张兜底页的耗时当接口延迟，错误率还是 0%。
//
// expect 由调用方声明这个端点该回什么：
//   "json"  Content-Type 含 json，能解析成对象，且没有 error 字段
//   "any"   只看状态（静态资源、首页 HTML、快照文件）
function bodyMatches(res, expect) {
  if (expect !== "json") return true;
  const type = String((res.headers && (res.headers["Content-Type"] || res.headers["content-type"])) || "");
  if (!type.toLowerCase().includes("json")) return false;
  try {
    const data = res.json();
    if (!data || typeof data !== "object") return false;
    return typeof data.error !== "string";
  } catch (e) {
    return false;
  }
}

export function probe(name, { expect = "any" } = {}) {
  const elapsed = new Trend(`ep_${name}_ms`, false);
  const errors = new Rate(`ep_${name}_err`);
  const throttled = new Rate(`ep_${name}_throttled`);
  const badBody = new Rate(`ep_${name}_bad_body`);

  return {
    // 判定默认只认 2xx，且响应体要符合 expect。以前 3xx 也算通过：k6 默认
    // 跟随重定向，剩下的 301/304 和「回 200 的维护页」一样会被记成成功。
    // 需要更宽或更严的调用方自己传 ok；传了 ok 也要再过 bodyMatches。
    record(res, ok) {
      const limited = res.status === 429;
      const statusOk = res.status >= 200 && res.status < 300;
      const statusPassed = ok ? Boolean(ok(res)) : statusOk;
      // 响应体只在 2xx 上要求：4xx/404 的形状由状态码和调用方的 ok 判定，
      // 比如删除「本来就不在」回 404 {"error":"not_found"} 是清理成功。
      const shapeOk = limited || !statusOk || bodyMatches(res, expect);
      const passed = statusPassed && shapeOk;
      if (!limited) {
        elapsed.add(res.timings.duration);
        servedMs.add(res.timings.duration);
      }
      errors.add(!passed && !limited);
      badBody.add(!limited && statusOk && !shapeOk);
      check(res, { [name]: () => passed });
      return res;
    },
  };
}
