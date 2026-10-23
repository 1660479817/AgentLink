import { clearSearchCache } from "./searchCache.js";

let publish = () => {};

export function setDiscoverPublisher(fn) {
  publish = typeof fn === "function" ? fn : () => {};
}

// 内容有变化：公开快照要重画，检索结果缓存也一并作废。
// 检索缓存只有几十秒的 TTL，但发布后立刻搜不到自己刚发的帖子是最容易被当成 bug 的那种。
export function touchDiscoverBoard() {
  clearSearchCache();
  publish();
}
