// 节点当地时间。
//
// 目录里每条实例显示它自己时区的钟点：联邦是分布在不同时区的人在同一份目录里，
// 这一点用真时间比用任何装饰都直接。这里只做格式化，不读系统时钟以外的状态。

const timeFormats = new Map();
const offsetFormats = new Map();

function formatter(cache, key, build) {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build();
  cache.set(key, made);
  return made;
}

// 时刻按 h23 输出，避免某些语种给出 24:00。
export function localTime(timeZone, locale = "en", at = new Date()) {
  if (!timeZone) return null;
  try {
    const fmt = formatter(timeFormats, `${locale}|${timeZone}`, () =>
      new Intl.DateTimeFormat(locale, {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
    );
    return fmt.format(at);
  } catch {
    return null;
  }
}

// 偏移写成 UTC+8、UTC+5:30、UTC+0，跨语种都能读。
export function utcOffset(timeZone, at = new Date()) {
  if (!timeZone) return null;
  let parts;
  try {
    const fmt = formatter(offsetFormats, timeZone, () =>
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    );
    parts = fmt.formatToParts(at);
  } catch {
    return null;
  }

  const raw = parts.find((part) => part.type === "timeZoneName")?.value || "";
  if (raw === "GMT" || raw === "UTC") return "UTC+0";
  const match = /^(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!match) return null;
  const [, sign, hours, minutes] = match;
  const rest = minutes && minutes !== "00" ? `:${minutes}` : "";
  return `UTC${sign}${Number(hours)}${rest}`;
}

// 相对访客当地日期，节点那边是昨天、今天还是明天。
// 只用在标签的 title 上，不占版面。viewerTimeZone 缺省即访客所在时区。
export function dayShift(timeZone, at = new Date(), viewerTimeZone) {
  if (!timeZone) return 0;
  try {
    const there = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
    const here = new Intl.DateTimeFormat("en-CA", {
      ...(viewerTimeZone ? { timeZone: viewerTimeZone } : {}),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
    if (there === here) return 0;
    return Math.round((Date.parse(`${there}T00:00:00Z`) - Date.parse(`${here}T00:00:00Z`)) / 86400000);
  } catch {
    return 0;
  }
}
