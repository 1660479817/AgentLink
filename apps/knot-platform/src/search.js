function compact(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function grams(text) {
  const out = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

export function scoreText(query, text) {
  const phrase = compact(query);
  if (!phrase) return 0;
  const hay = compact(text);
  if (!hay) return 0;
  if (phrase.length === 1) return hay.includes(phrase) ? 1 : 0;
  let score = hay.includes(phrase) ? phrase.length : 0;
  for (const piece of new Set(grams(phrase))) {
    if (hay.includes(piece)) score += 1;
  }
  return score;
}
