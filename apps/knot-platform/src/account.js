const FOREVER_YEAR = 9999;

export function muteState(value, now = new Date()) {
  if (value == null || value === "") return { muted: false, mutedUntil: null };
  const time = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(time.getTime()) || time.getTime() <= now.getTime()) {
    return { muted: false, mutedUntil: null };
  }
  if (time.getUTCFullYear() >= FOREVER_YEAR) return { muted: true, mutedUntil: null };
  return { muted: true, mutedUntil: time.toISOString() };
}

export function honorList(value) {
  const honors = value && typeof value === "object" && !Array.isArray(value) ? value.honors : null;
  if (!Array.isArray(honors)) return [];
  return honors.filter((item) => typeof item === "string" && item.trim());
}

export async function assertCanSpeak(pool, userId) {
  const { rows } = await pool.query(`SELECT muted_until FROM users WHERE id = $1`, [userId]);
  if (!muteState(rows[0]?.muted_until).muted) return;
  const error = new Error("muted");
  error.code = "muted";
  throw error;
}
