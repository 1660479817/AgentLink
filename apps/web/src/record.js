export function metaOf(item) {
  return item?.kMeta || {};
}

export function priceOf(item) {
  return Number(item?.kMeta?.commerce?.price) || 0;
}

export function feeOf(item) {
  return Number(item?.kMeta?.commerce?.fee) || 0;
}
