import assert from "node:assert/strict";
import test from "node:test";
import { allow, resetRateLimit, retryAfterSeconds } from "./rateLimit.js";

test("a limit of zero means no limiting", () => {
  resetRateLimit();
  for (let i = 0; i < 100; i += 1) assert.equal(allow("k", 0, 60_000, 1_000), true);
});

test("the window allows exactly the configured number of calls", () => {
  resetRateLimit();
  assert.equal(allow("k", 2, 60_000, 1_000), true);
  assert.equal(allow("k", 2, 60_000, 1_001), true);
  assert.equal(allow("k", 2, 60_000, 1_002), false);
});

test("the counter resets when the window rolls over", () => {
  resetRateLimit();
  assert.equal(allow("k", 1, 60_000, 1_000), true);
  assert.equal(allow("k", 1, 60_000, 2_000), false);
  assert.equal(allow("k", 1, 60_000, 61_000), true);
});

test("each identity has its own bucket", () => {
  resetRateLimit();
  assert.equal(allow("search:a", 1, 60_000, 1_000), true);
  assert.equal(allow("search:a", 1, 60_000, 1_001), false);
  assert.equal(allow("search:b", 1, 60_000, 1_001), true);
});

test("an empty identity is never limited", () => {
  resetRateLimit();
  for (let i = 0; i < 10; i += 1) assert.equal(allow("", 1, 60_000, 1_000), true);
});

test("a short window never expires a bucket that belongs to a longer one", () => {
  resetRateLimit();
  // 信息检索：每小时 2 次。
  assert.equal(allow("retrieve:a", 2, 3_600_000, 1_000), true);
  assert.equal(allow("retrieve:a", 2, 3_600_000, 1_100), true);
  assert.equal(allow("retrieve:a", 2, 3_600_000, 1_200), false);
  // 大量每分钟一次的检索把表撑到需要清理；1 小时前的检索 bucket 不能被当成过期删掉。
  for (let i = 0; i < 6000; i += 1) allow(`search:u${i}`, 5, 60_000, 120_000 + i);
  assert.equal(allow("retrieve:a", 2, 3_600_000, 121_000), false);
});

test("changing the window length restarts the count instead of mixing units", () => {
  resetRateLimit();
  assert.equal(allow("k", 1, 60_000, 1_000), true);
  // 运维把窗口改成 1 小时：旧计数属于另一张表，不能直接当成新窗口的用量。
  assert.equal(allow("k", 1, 3_600_000, 2_000), true);
  assert.equal(allow("k", 1, 3_600_000, 3_000), false);
});

test("retryAfterSeconds 给出窗口剩余秒数，没进过桶或窗口已翻页时为 null", () => {
  resetRateLimit();
  assert.equal(allow("k", 1, 60_000, 1_000), true);
  // 刚进窗口：还要等满一分钟。
  assert.equal(retryAfterSeconds("k", 60_000, 1_000), 60);
  assert.equal(allow("k", 1, 60_000, 31_000), false);
  assert.equal(retryAfterSeconds("k", 60_000, 31_000), 30);
  // 不足一秒也按一秒算，避免客户端拿到 0 立刻重试。
  assert.equal(retryAfterSeconds("k", 60_000, 60_500), 1);
  // 没见过的身份、或者窗口已经翻页：没有可等的。
  assert.equal(retryAfterSeconds("nobody", 60_000, 31_000), null);
  assert.equal(retryAfterSeconds("k", 60_000, 61_000), null);
  // 不同窗口长度的表互不相干。
  assert.equal(retryAfterSeconds("k", 3_600_000, 31_000), null);
});
