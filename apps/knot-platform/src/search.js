const ROLE_WORDS = [
  ["需求", "demand"],
  ["供给", "supply"],
  ["情报", "intel"],
];

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

export function scoreInformation(query, item) {
  const phrase = compact(query);
  if (!phrase) return 0;
  const subject = typeof item.card?.subject === "string" ? item.card.subject : "";
  const hay = compact(
    `${item.body || ""} ${item.processed || ""} ${subject} ${item.intel_category || ""} ${item.intel_fact || ""}`
  );
  if (!hay) return 0;
  if (phrase.length === 1) return hay.includes(phrase) ? 1 : 0;
  let score = hay.includes(phrase) ? phrase.length : 0;
  for (const piece of new Set(grams(phrase))) {
    if (hay.includes(piece)) score += 1;
  }
  for (const [word, role] of ROLE_WORDS) {
    if (String(query).includes(word) && item.role === role) score += 2;
  }
  return score;
}
