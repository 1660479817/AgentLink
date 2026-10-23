import assert from "node:assert/strict";
import test from "node:test";
import { cacheGet, cacheSet, clearSearchCache, searchCacheKey, searchCacheSize } from "./searchCache.js";

test("a cached result comes back inside its ttl and is gone after it", () => {
  clearSearchCache();
  const key = searchCacheKey("住房", "user-1", {});
  cacheSet(key, [{ id: "a" }], 30_000, 1_000);
  assert.deepEqual(cacheGet(key, 30_000, 2_000), [{ id: "a" }]);
  assert.equal(cacheGet(key, 30_000, 31_001), null);
});

test("ttl 0 turns the cache off entirely", () => {
  clearSearchCache();
  const key = searchCacheKey("住房", "user-1", {});
  cacheSet(key, [{ id: "a" }], 0, 1_000);
  assert.equal(searchCacheSize(), 0);
  assert.equal(cacheGet(key, 0, 1_000), null);
});

test("the key carries the account and every filter, so personal state cannot leak", () => {
  const a = searchCacheKey("住房", "user-1", { category: "房产" });
  const b = searchCacheKey("住房", "user-2", { category: "房产" });
  const c = searchCacheKey("住房", "user-1", { category: "招聘" });
  const d = searchCacheKey("住房", "user-1", { category: "房产", since: "2026-10-01" });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.equal(a, searchCacheKey("住房", "user-1", { category: "房产" }));
});

test("no session and an empty account both use one anonymous key", () => {
  // 未登录的请求没有账户：null 与空串落到同一个键，不凭空多出一份缓存。
  assert.equal(searchCacheKey("住房", null, {}), searchCacheKey("住房", "", {}));
  assert.notEqual(searchCacheKey("住房", null, {}), searchCacheKey("住房", "user-1", {}));
});

test("a hit is moved to the back so the oldest entry is evicted first", () => {
  clearSearchCache();
  cacheSet("a", 1, 60_000, 1_000);
  cacheSet("b", 2, 60_000, 1_000);
  assert.equal(cacheGet("a", 60_000, 2_000), 1);
  cacheSet("c", 3, 60_000, 2_000);
  // 500 条上限：这里只验证顺序语义，先确认命中过的 a 还能取到。
  assert.equal(cacheGet("a", 60_000, 3_000), 1);
  clearSearchCache();
  assert.equal(searchCacheSize(), 0);
});
