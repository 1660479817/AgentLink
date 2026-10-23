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

function meta(extra = {}) {
  return {
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
    ...extra,
  };
}

test("整档 100% 429 时没有样本，判为无结论而不是通过", () => {
  const parsed = parseSummaryData({
    metrics: {
      http_reqs: { count: 10, rate: 1 },
      ep_search_err: { passes: 0, fails: 10, value: 0 },
      ep_search_throttled: { passes: 10, fails: 0, value: 1 },
    },
  });
  // 一个请求都没被服务时错误率是「未知」，不是 0。
  assert.equal(parsed.errorRate, null);
  assert.equal(parsed.endpoints.search.count, 0);
  assert.equal(parsed.endpoints.search.p95, null);

  const md = render({ meta: meta(), runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }] });
  assert.match(md, /无结论：1 项没有样本/);
  assert.match(md, /没有样本（请求 10 次，其中 429 10 次）/);
  // 不能只写「未超过验收线」：那正是这条发现里被误读成通过的句子。
  assert.doesNotMatch(md, /^未超过验收线：读 p95/m);
  assert.match(md, /结论：本轮有 1 项无样本/);
});

test("k6 失败档进「本轮未测」，判定写明结论不完整", () => {
  const parsed = parseSummaryData(LIMITED);
  const md = render({
    meta: meta({
      failed: [
        {
          scenario: "agent",
          vus: 100,
          status: null,
          signal: "SIGTERM",
          elapsedMs: 125000,
          detail: "被信号 SIGTERM 终止\nk6 被 timeout 杀掉",
        },
      ],
    }),
    runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }],
  });

  assert.match(md, /本轮未测：/);
  assert.match(md, /Agent 读 100 并发：k6 未跑成（被信号 SIGTERM 终止，125s） · k6 被 timeout 杀掉/);
  assert.match(md, /结论不完整：1 档 k6 未跑成/);
  assert.match(md, /结论：本轮有 1 档未跑成/);
  assert.doesNotMatch(md, /^未超过验收线：读 p95/m);
});

test("写场景的发布 / 删除 / 残留与清理失败率写进报告", () => {
  const parsed = parseSummaryData({
    metrics: {
      http_reqs: { count: 8, rate: 0.8 },
      ep_write_publish_ms: { count: 5, med: 10, "p(95)": 20, "p(99)": 30 },
      ep_write_publish_err: { passes: 0, fails: 5, value: 0 },
      ep_write_publish_throttled: { passes: 0, fails: 5, value: 0 },
      ep_write_delete_ms: { count: 3, med: 10, "p(95)": 20, "p(99)": 30 },
      ep_write_delete_err: { passes: 0, fails: 3, value: 0 },
      ep_write_delete_throttled: { passes: 0, fails: 3, value: 0 },
      write_cleanup_err: { passes: 2, fails: 3, value: 0.4 },
      write_created: { count: 5 },
      write_deleted: { count: 3 },
      write_leftover: { count: 2 },
    },
  });

  assert.equal(parsed.cleanup.created, 5);
  assert.equal(parsed.cleanup.deleted, 3);
  assert.equal(parsed.cleanup.leftover, 2);
  assert.ok(Math.abs(parsed.cleanup.errRate - 0.4) < 1e-9);

  const md = render({ meta: meta(), runs: [{ scenario: "write", vus: 5, duration: "20s", ...parsed }] });
  assert.match(md, /写场景清理/);
  assert.match(md, /\| 5 \| 5 \| 3 \| 2 \| 40\.00% \|/);
  assert.match(md, /2 条记录没有删掉/);
  assert.match(md, /结论：本轮有 2 条写记录未清理/);
});

test("一次失败都没有时清理失败率记 0，残留用「发布 - 删除」补 0", () => {
  // k6 不会导出只 add(false) 的 Rate，也不会导出从未 add 的 Counter；
  // 这两条指标缺席表示「没有失败、没有残留」，不是「没有数据」。
  const parsed = parseSummaryData({
    metrics: {
      write_created: { count: 1 },
      write_deleted: { count: 1 },
    },
  });
  assert.equal(parsed.cleanup.created, 1);
  assert.equal(parsed.cleanup.deleted, 1);
  assert.equal(parsed.cleanup.leftover, 0);
  assert.equal(parsed.cleanup.errRate, 0);
});

test("没有清理指标的旧结果照常渲染，不出清理表", () => {
  const parsed = parseSummaryData(LIMITED);
  assert.equal(parsed.cleanup, null);
  const md = render({ meta: meta(), runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }] });
  assert.doesNotMatch(md, /写场景清理/);
});

test("p95 的判定与展示用同一个数，不出「1000ms > 1000ms」", () => {
  const parsed = parseSummaryData({
    metrics: {
      http_reqs: { count: 10, rate: 1 },
      ep_home_ms: { count: 10, med: 100, "p(95)": 1000.4, "p(99)": 1200 },
      ep_home_err: { passes: 0, fails: 10, value: 0 },
      ep_home_throttled: { passes: 0, fails: 10, value: 0 },
    },
  });
  const md = render({ meta: meta(), runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }] });
  // 未取整的 1000.4 超过线，取整后显示 1000：判定段以前会写出自相矛盾的一行。
  assert.doesNotMatch(md, /p95 1000ms > 1000ms/);
  assert.match(md, /未超过验收线/);
});

test("k6 在运行中给的提示写进报告", () => {
  const parsed = parseSummaryData(LIMITED);
  const md = render({
    meta: meta({ warnings: ["agent 20 并发：setup: 公开信息流为空，卡片详情将跳过"] }),
    runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }],
  });
  assert.match(md, /本轮 k6 提示：/);
  assert.match(md, /公开信息流为空/);
});

test("2xx 但响应体不符预期：计入错误率，并单列 bad_body", () => {
  const parsed = parseSummaryData({
    metrics: {
      http_reqs: { count: 100, rate: 10 },
      served_ms: { count: 100, med: 20, "p(95)": 90, "p(99)": 100 },
      ep_session_ms: { count: 100, med: 20, "p(95)": 90, "p(99)": 100 },
      // 100 次里 100 次状态 2xx，其中 40 次回的是 HTML 维护页（不是 JSON）。
      ep_session_err: { passes: 40, fails: 60, value: 0.4 },
      ep_session_throttled: { passes: 0, fails: 100, value: 0 },
      ep_session_bad_body: { passes: 40, fails: 60, value: 0.4 },
    },
  });

  assert.equal(parsed.endpoints.session.badBody, 40);
  assert.ok(Math.abs(parsed.endpoints.session.badBodyRate - 0.4) < 1e-9);
  assert.equal(parsed.badBody, 40);
  // 只回 2xx 不算成功：错误率必须跟着抬头。
  assert.ok(Math.abs(parsed.errorRate - 0.4) < 1e-9);

  const md = render({ meta: meta(), runs: [{ scenario: "read", vus: 20, duration: "10s", ...parsed }] });
  assert.match(md, /响应体不符预期：1 项/);
  assert.match(md, /40 次状态 2xx 但响应体不符预期/);
  assert.match(md, /ep_<name>_bad_body/);
});
