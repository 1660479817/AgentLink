import { wishDeadlineOf } from "./record.js";

export function wishText(wish, fallback = "") {
  const body = String(wish?.body || "").trim();
  if (body) return body;
  const file = [...(wish?.images || []), ...(wish?.audio || []), ...(wish?.attachments || [])][0];
  return file?.name || file?.url || fallback;
}

export function wishTo(wish) {
  return wish?.mine
    ? { name: "wish", query: { wish: wish.id } }
    : { name: "wish", query: { respond: wish.id } };
}

// 剩余小时数向上取整；已经到期返回 0，没有时间数据返回 null。
export function wishHoursLeft(wish, now = Date.now()) {
  const deadline = wishDeadlineOf(wish);
  if (deadline === null) return null;
  const left = deadline - now;
  if (left <= 0) return 0;
  return Math.ceil(left / (60 * 60 * 1000));
}
