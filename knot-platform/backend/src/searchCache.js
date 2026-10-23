// 检索结果缓存：只吸收「同一个人、同一句、同样筛选」的重复轮询。
// 键里带账户，所以个人态（星、赞、已下载、好友）不会串号；内容有变更时由
// touchDiscoverBoard() 清空，最坏情况也就多等一个 TTL。
//
// 缓存的是 searchPublicIntel 已经打完分、排好序的行数组。调用方只读不写：
// 拿到后都是 spread 出新的展示对象，不原地改行。

const store = new Map();
const MAX_ENTRIES = 500;

export function searchCacheKey(query, userId, filters = {}) {
  const bag = filters && typeof filters === "object" ? filters : {};
  return [userId || "", query, bag.category || "", bag.topic || "", bag.source || "", bag.since || ""].join("\u0000");
}

export function cacheGet(key, ttlMs, now = Date.now()) {
  if (!ttlMs) return null;
  const hit = store.get(key);
  if (!hit) return null;
  if (now - hit.at >= ttlMs) {
    store.delete(key);
    return null;
  }
  // 命中时挪到队尾：Map 的插入顺序就是 LRU 顺序。
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

export function cacheSet(key, value, ttlMs, now = Date.now()) {
  if (!ttlMs) return;
  store.delete(key);
  store.set(key, { at: now, value });
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
}

export function clearSearchCache() {
  store.clear();
}

export function searchCacheSize() {
  return store.size;
}
