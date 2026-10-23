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

// 旧行可能没有 expires_at，按创建时间加 24 小时算；有就用库里那个时刻。
// 公开快照的到期扫描也走这个表达式，两边对「什么时候算到期」只有一种说法（S14-07）。
export function wishDeadline(alias = "i") {
  return `COALESCE(${alias}.expires_at, ${alias}.created_at + interval '${WISH_DEFAULT_HOURS} hours')`;
}

// 只留当前仍在有效期内的 wish。
export function wishLive(alias = "i") {
  return `${wishDeadline(alias)} > now()`;
}
