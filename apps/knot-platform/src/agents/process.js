export function normalize(body) {
  return String(body || "").replace(/\s+/g, " ").trim();
}
