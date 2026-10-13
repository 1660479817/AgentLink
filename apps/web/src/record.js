export function metaOf(item) {
  return item?.kMeta || {};
}

export function priceOf(item) {
  return Number(item?.kMeta?.commerce?.price) || 0;
}

export function payeeOf(item) {
  return item?.kMeta?.commerce?.payee === "platform" ? "platform" : "author";
}
