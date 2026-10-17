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

export function wishDeadlineOf(item) {
  const meta = item?.kMeta || {};
  const expires = Date.parse(meta.expiresAt || "");
  if (Number.isFinite(expires)) return expires;
  const created = Date.parse(meta.createdAt || "");
  if (!Number.isFinite(created)) return null;
  return created + WISH_MAX_HOURS * 60 * 60 * 1000;
}

// 前端只展示仍在有效期内的 wish。没有时间的旧数据不隐藏。
export function wishIsLive(item, now = Date.now()) {
  const deadline = wishDeadlineOf(item);
  return deadline === null || deadline > now;
}
