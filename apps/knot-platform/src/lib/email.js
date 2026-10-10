export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isPlausibleEmail(email) {
  const e = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
