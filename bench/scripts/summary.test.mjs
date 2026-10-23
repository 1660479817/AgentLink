import test from "node:test";
import assert from "node:assert/strict";
import { parseSummaryData } from "./summary.mjs";
import { render } from "./report.mjs";

// 一份「search 被限流」的 summary：search 发 100 次，20 次 429，80 次正常；home 发 100 次，1 次真错误。
const LIMITED = {
  metrics: {
    http_reqs: { count: 200, rate: 20 },
    served_ms: { count: 180, med: 20, "p(95)": 300, "p(99)": 500 },
    http_req_duration: { count: 200, med: 5, "p(95)": 100, "p(99)": 600 },
    ep_search_ms: { count: 80, med: 50, "p(95)": 300, "p(99)": 500 },
    ep_search_err: { passes: 0, fails: 100, value: 0 },
    ep_search_throttled: { passes: 20, fails: 80, value: 0.2 },
    ep_home_ms: { count: 100, med: 20, "p(95)": 90, "p(99)": 100 },
    ep_home_err: { passes: 1, fails: 99, value: 0.01 },
    ep_home_throttled: { passes: 0, fails: 100, value: 0 },
  },
};

test("429 不算错误，也不进 p95", () => {
  const parsed = parseSummaryData(LIMITED);
  assert.equal(parsed.endpoints.search.errRate, 0);
  assert.equal(parsed.endpoints.search.throttleRate, 0.2);
  assert.equal(parsed.endpoints.search.throttled, 20);
  assert.equal(parsed.endpoints.search.count, 80);
  assert.equal(parsed.endpoints.search.p95, 300);
  assert.equal(parsed.served, 180);
  assert.equal(parsed.throttled, 20);
  assert.equal(parsed.throttleRate, 0.1);
  assert.ok(Math.abs(parsed.errorRate - 1 / 180) < 1e-9);
  // 总览优先用 served_ms（180 个未被限流的请求），而不是把 429 也算进去的 http_req_duration。
  assert.equal(parsed.overall.p95, 300);
});

test("只有 429 的端点也能被解析出来（_ms 没有样本）", () => {
  const parsed = parseSummaryData({
    metrics: {
      http_reqs: { count: 10, rate: 1 },
      ep_search_err: { passes: 0, fails: 10, value: 0 },
      ep_search_throttled: { passes: 10, fails: 0, value: 1 },
    },
  });
  assert.equal(parsed.endpoints.search.count, 0);
  assert.equal(parsed.endpoints.search.throttleRate, 1);
  assert.equal(parsed.endpoints.search.p95, null);
});

test("旧结果没有 _throttled、且 values 包了一层时仍能解析", () => {
  const parsed = parseSummaryData({
    metrics: {
      http_reqs: { values: { count: 50, rate: 5 } },
      http_req_duration: { values: { med: 30, "p(95)": 80, "p(99)": 90 } },
      ep_home_ms: { values: { count: 50, med: 30, "p(95)": 80, "p(99)": 90 } },
      ep_home_err: { values: { passes: 0, fails: 50, value: 0 } },
    },
  });
  assert.equal(parsed.endpoints.home.throttleRate, 0);
  assert.equal(parsed.throttled, 0);
  assert.equal(parsed.errorRate, 0);
});

test("报告把 429 单列，不把它算成超验收线", () => {
  const parsed = parseSummaryData(LIMITED);
  const md = render({
    meta: {
      base: "https://example.xknot.si",
      host: "example.xknot.si",
      machine: "test",
      k6: "k6 v2",
      git: "abc123",
      duration: "10s",
      cooldown: 3,
      startedAt: "2026-10-23T06:00:00.000Z",
      finishedAt: "2026-10-23T06:01:00.000Z",
      target: { host: "example.xknot.si", capabilities: {} },
      identity: { mode: "cookie", cookies: 2, tokens: 1, warning: "" },
    },
    runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }],
  });

  assert.match(md, /限流率/);
  assert.match(md, /各端点限流（429）/);
  assert.match(md, /另有 20 次 429 限流/);
  assert.match(md, /每 VU 一份 Cookie（2 份）/);
  assert.match(md, /未超过验收线/);
  assert.doesNotMatch(md, /超过验收线 \d+ 项/);
});
