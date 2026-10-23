export function metaOf(item) {
  return item?.kMeta || {};
}

export function priceOf(item) {
  return Number(item?.kMeta?.commerce?.price) || 0;
}

export function feeOf(item) {
  return Number(item?.kMeta?.commerce?.fee) || 0;
}

const WISH_MAX_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

// wish 的截止时间：expiresAt 优先，018 之前的旧数据按创建时间 + 24 小时。
export function wishDeadlineOf(item) {
  const meta = item?.kMeta || {};
  const expires = Date.parse(meta.expiresAt || "");
  if (Number.isFinite(expires)) return expires;
  const created = Date.parse(meta.createdAt || "");
  if (!Number.isFinite(created)) return null;
  return created + WISH_MAX_HOURS * HOUR_MS;
}

// 一条记录会不会因为时间失效、什么时候失效。
// 只有 wish 和出售帖（有可下载附件）会写 expiresAt；免费 post/fastpost 是 null。
// 025 已经把存量出售帖回填过，018 回填过存量 wish，所以这里的 fallback 只兜很旧的数据。
export function expiryOf(item) {
  const meta = metaOf(item);
  const expires = Date.parse(meta.expiresAt || "");
  if (Number.isFinite(expires)) return expires;
  return meta.kind === "wish" ? wishDeadlineOf(item) : null;
}

// 剩余小时数向上取整。没有失效时间返回 null，已到期返回 0。
export function hoursLeftAt(deadline, now = Date.now()) {
  if (deadline === null || deadline === undefined) return null;
  const left = deadline - now;
  if (left <= 0) return 0;
  return Math.ceil(left / HOUR_MS);
}

// 卡片直接用的那一个：null = 不会失效，0 = 已到期，n = 还剩 n 小时。
export function hoursLeftOf(item, now = Date.now()) {
  return hoursLeftAt(expiryOf(item), now);
}

// 前端只展示仍在有效期内的 wish。没有时间的旧数据不隐藏。
export function wishIsLive(item, now = Date.now()) {
  const deadline = wishDeadlineOf(item);
  return deadline === null || deadline > now;
}

// 审核结果 → 文案键。投稿列表与 wish 页原先各抄一份，改一处忘一处就会不一致。
export function statusKey(verdict) {
  if (verdict === "passed") return "submissions.statusPublished";
  if (verdict === "rejected") return "submissions.statusRejected";
  if (verdict === "removed") return "submissions.statusRemoved";
  return "submissions.statusPending";
}
