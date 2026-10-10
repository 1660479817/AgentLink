export function overlapScore(a, b) {
  const x = String(a || "").trim();
  const y = String(b || "").trim();
  if (x.length < 2 || y.length < 2) return 0;
  const seen = new Set();
  let score = 0;
  for (let i = 0; i < x.length - 1; i += 1) {
    const gram = x.slice(i, i + 2);
    if (gram.trim().length < 2 || seen.has(gram)) continue;
    seen.add(gram);
    if (y.includes(gram)) score += 1;
  }
  return score;
}

export function fits(a, b) {
  return overlapScore(a, b) > 0;
}
