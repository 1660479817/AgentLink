import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { normalizeEmail } from "./email.js";

export const CODE_TTL_MS = 10 * 60_000;
export const SESSION_TTL_MS = 14 * 24 * 3600_000;
export const SEND_COOLDOWN_MS = 60_000;
export const SEND_HOUR_MAX = 5;
export const SEND_HOUR_MS = 3600_000;
export const VERIFY_MAX_ATTEMPTS = 5;

export function newLoginCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newSessionId() {
  return createHash("sha256")
    .update(`${Date.now()}:${randomInt(0, 1e9)}`)
    .digest("hex");
}

export function hashLoginCode(email, code) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${String(code || "").trim()}`)
    .digest("hex");
}

function safeEqualHex(left, right) {
  const ls = String(left || "");
  const rs = String(right || "");
  if (ls.length !== 64 || rs.length !== 64 || !/^[0-9a-f]+$/.test(ls) || !/^[0-9a-f]+$/.test(rs)) {
    return false;
  }
  const a = Buffer.from(ls, "hex");
  const b = Buffer.from(rs, "hex");
  if (a.length !== 32 || b.length !== 32) return false;
  return timingSafeEqual(a, b);
}

export function decideSend(row, now) {
  if (!row) return { ok: true, sendCountHour: 1, hourStartedAt: now };
  if (now - Number(row.sent_at) < SEND_COOLDOWN_MS) return { ok: false, reason: "too_soon" };
  let sendCountHour = Number(row.send_count_hour || 0);
  let hourStartedAt = Number(row.hour_started_at || now);
  if (now - hourStartedAt >= SEND_HOUR_MS) {
    sendCountHour = 0;
    hourStartedAt = now;
  }
  if (sendCountHour >= SEND_HOUR_MAX) return { ok: false, reason: "too_many" };
  return { ok: true, sendCountHour: sendCountHour + 1, hourStartedAt };
}

export function decideVerify(row, email, code, now) {
  const digits = String(code || "").trim();
  if (!/^\d{6}$/.test(digits)) return { ok: false, reason: "bad_code" };
  if (!row) return { ok: false, reason: "bad_code" };
  if (Number(row.expires_at) <= now) return { ok: false, reason: "expired" };
  if (Number(row.attempts) >= VERIFY_MAX_ATTEMPTS) return { ok: false, reason: "too_many" };
  const hash = hashLoginCode(email, digits);
  if (!safeEqualHex(hash, row.code_hash)) {
    return { ok: false, reason: "bad_code", bump: true };
  }
  return { ok: true };
}
