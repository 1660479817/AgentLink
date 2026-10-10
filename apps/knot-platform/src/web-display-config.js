const DEFAULTS = {
  refreshAfterMs: 60_000,
  statsTimezone: "Asia/Hong_Kong",
  homePreviewSize: 5,
  cardsTotalMode: "public_visible",
  plazaDefaultLimit: 20,
};

export async function loadWebDisplayConfig(pool) {
  const { rows } = await pool.query(
    "SELECT value FROM system_config WHERE key = $1",
    ["webDisplay"]
  );
  const v = rows[0]?.value;
  if (!v || typeof v !== "object") return { ...DEFAULTS };
  return {
    refreshAfterMs: Number(v.refreshAfterMs) || DEFAULTS.refreshAfterMs,
    statsTimezone: String(v.statsTimezone || DEFAULTS.statsTimezone),
    homePreviewSize: Math.min(10, Math.max(0, Number(v.homePreviewSize) || 5)),
    cardsTotalMode: v.cardsTotalMode === "all_cards" ? "all_cards" : "public_visible",
    plazaDefaultLimit: Math.min(50, Math.max(1, Number(v.plazaDefaultLimit) || 20)),
  };
}

/** 今日区间 [start, end) 用于 stats，基于 timezone 字符串（简化：Asia/Hong_Kong） */
export function todayBoundsUtc(timezone) {
  const now = new Date();
  if (timezone === "Asia/Hong_Kong") {
    const offsetMs = 8 * 3600_000;
    const localMs = now.getTime() + offsetMs;
    const dayStartLocal = Math.floor(localMs / 86400_000) * 86400_000;
    const start = new Date(dayStartLocal - offsetMs);
    return { start, end: now };
  }
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end: now };
}
