// 固定窗口计数：同一把身份在一个窗口内超过上限就不再放行。
//
// 只解决「代理轮询、脚本刷」这种量级的问题，不做平滑与排队；窗口刻意做成固定，
// 是为了让行为可预测：运维看到的「每分钟 N 次」就是真的一分钟 N 次。
// 限流跑在应用层，因为要按账户算——入口主机分不出是谁，也不该替实例决定配额。
//
// 不同的调用用不同长度的窗口（检索 60 秒，信息检索 1 小时）。每个窗口一张表：
// 清理与容量上限互不相干，短窗口的清理不会把长窗口的计数当成过期删掉，
// 否则「每小时 10 次」会被一次检索请求重置成「又能再来 10 次」。

const windows = new Map();
const MAX_KEYS = 5000;

function sweep(buckets, now, windowMs) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.start >= windowMs) buckets.delete(key);
  }
  // 仍在窗口内的身份过多：只丢最早的，防止表无限增长。代价是那个身份的计数从头算，
  // 所以上限放在 5000（远高于单实例的真实身份数）。
  while (buckets.size > MAX_KEYS) buckets.delete(buckets.keys().next().value);
}

export function allow(key, limit, windowMs, now = Date.now()) {
  const id = String(key || "");
  if (!id || !limit || limit <= 0 || !windowMs || windowMs <= 0) return true;
  let buckets = windows.get(windowMs);
  if (!buckets) {
    buckets = new Map();
    windows.set(windowMs, buckets);
  }
  const bucket = buckets.get(id);
  if (!bucket || now - bucket.start >= windowMs) {
    buckets.set(id, { start: now, count: 1 });
    if (buckets.size > MAX_KEYS) sweep(buckets, now, windowMs);
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function resetRateLimit() {
  windows.clear();
}
