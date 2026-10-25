// 一条记录的标价。内容（post / fastpost）永远是 0，价格只存在于 Store 的商品上。
export function priceOf(item) {
  return Number(item?.kMeta?.commerce?.price) || 0;
}

// 审核结果 → 文案键。投稿列表与货架原先各抄一份，改一处忘一处就会不一致。
export function statusKey(verdict) {
  if (verdict === "passed") return "submissions.statusPublished";
  if (verdict === "rejected") return "submissions.statusRejected";
  if (verdict === "removed") return "submissions.statusRemoved";
  return "submissions.statusPending";
}

// 记录种类 → 文案键。商品是货架上的一件东西，不是帖子的一种。
export function kindKey(kind) {
  if (kind === "item") return "submissions.kindItem";
  if (kind === "fastpost") return "submissions.kindFastpost";
  return "submissions.kindPost";
}

// 货架状态 → 文案键。只有商品有货架状态，帖子两者都不是。
export function shelfKey(state) {
  if (state === "withdrawn") return "store.withdrawn";
  if (state === "on_sale") return "store.onSale";
  return "";
}
