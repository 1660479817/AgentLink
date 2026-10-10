export function fits(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (x.length < 2 || y.length < 2) return false;
  if (x.includes(y) || y.includes(x)) return true;
  for (let i = 0; i < x.length - 1; i += 1) {
    const gram = x.slice(i, i + 2);
    if (gram.trim().length < 2) continue;
    if (y.includes(gram)) return true;
  }
  return false;
}
