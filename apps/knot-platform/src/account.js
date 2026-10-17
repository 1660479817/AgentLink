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
export const NAME_MAX = 40;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function bioText(value) {
  if (value == null) return "";
  if (typeof value !== "string") throw fail("bad_bio");
  const text = value.replace(/\r\n?/g, "\n").trim();
  if (text.length > BIO_MAX) throw fail("bad_bio");
  return text;
}

// 称呼：连续空白收成一个，首尾去掉，非空且不超过 40 个字（按码点算，和库里的 char_length 一致）。
export function displayNameText(value) {
  if (typeof value !== "string") throw fail("bad_name");
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || Array.from(text).length > NAME_MAX) throw fail("bad_name");
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
  if (!Array.isArray(value)) throw fail("bad_specialty");
  const names = [];
  for (const item of value) {
    const text = String(item ?? "").replace(/\s+/g, " ").trim();
    if (!text || text.length > SPECIALTY_LEN || /[、,，]/.test(text)) throw fail("bad_specialty");
    if (!names.includes(text)) names.push(text);
  }
  if (names.length > SPECIALTY_MAX) throw fail("bad_specialty");
  return names;
}

export async function assertCanSpeak(pool, userId) {
  const { rows } = await pool.query(`SELECT muted_until FROM users WHERE id = $1`, [userId]);
  if (!muteState(rows[0]?.muted_until).muted) return;
  throw fail("muted");
}
