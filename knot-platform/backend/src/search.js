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
  const pieces = [...new Set(grams(phrase))];
  const hits = pieces.filter((piece) => hay.includes(piece)).length;
  if (!hits) return 0;
  // 完整短语命中给高分（短语长度 + 二元组命中数，>= 2）；只有零散二元组命中时返回命中占比（< 1）。
  // 调用方据此区分「完整命中」和「只碰到几个字的弱信号」，后者不再塞满结果。
  if (hay.includes(phrase)) return phrase.length + hits;
  return hits / pieces.length;
}
