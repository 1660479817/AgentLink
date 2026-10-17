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

const SPECIALTY_MAX = 8;
const SPECIALTY_LEN = 20;
export const BIO_MAX = 200;

export function bioText(value) {
  if (value == null) return "";
  if (typeof value !== "string") {
    const error = new Error("bad_bio");
    error.code = "bad_bio";
    throw error;
  }
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > BIO_MAX) {
    const error = new Error("bad_bio");
    error.code = "bad_bio";
    throw error;
  }
  return text;
}

export function honorList(value) {
  const honors = value && typeof value === "object" && !Array.isArray(value) ? value.honors : null;
  if (!Array.isArray(honors)) return [];
  return honors.filter((item) => typeof item === "string" && item.trim());
}

export function storedSpecialties(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string" && item.trim());
}

export function specialtyList(value) {
  if (!Array.isArray(value)) {
    const error = new Error("bad_specialty");
    error.code = "bad_specialty";
    throw error;
  }
  const names = [];
  for (const item of value) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > SPECIALTY_LEN || /[、,，]/.test(text)) {
      const error = new Error("bad_specialty");
      error.code = "bad_specialty";
      throw error;
    }
    if (!names.includes(text)) names.push(text);
  }
  if (names.length > SPECIALTY_MAX) {
    const error = new Error("bad_specialty");
    error.code = "bad_specialty";
    throw error;
  }
  return names;
}

export async function assertCanSpeak(pool, userId) {
  const { rows } = await pool.query(`SELECT muted_until FROM users WHERE id = $1`, [userId]);
  if (!muteState(rows[0]?.muted_until).muted) return;
  const error = new Error("muted");
  error.code = "muted";
  throw error;
}
