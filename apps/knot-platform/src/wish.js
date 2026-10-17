// wish 的有效期以小时计，最长 24 小时。
export const WISH_MAX_HOURS = 24;
export const WISH_DEFAULT_HOURS = 24;

export function wishHours(value) {
  if (value === undefined || value === null || value === "") return WISH_DEFAULT_HOURS;
  const hours = typeof value === "string" ? Number(value.trim()) : value;
  if (!Number.isInteger(hours) || hours < 1 || hours > WISH_MAX_HOURS) {
    const error = new Error("bad_duration");
    error.code = "bad_duration";
    throw error;
  }
  return hours;
}

export function wishExpiresAt(hours, now = Date.now()) {
  return new Date(now + hours * 60 * 60 * 1000);
}

// 018 迁移前写下的 wish 没有 expires_at，按创建时间加 24 小时算。
function wishDeadline(alias = "i") {
  return `COALESCE(${alias}.expires_at, ${alias}.created_at + interval '${WISH_DEFAULT_HOURS} hours')`;
}

// 只留当前仍在有效期内的 wish。
export function wishLive(alias = "i") {
  return `${wishDeadline(alias)} > now()`;
}
