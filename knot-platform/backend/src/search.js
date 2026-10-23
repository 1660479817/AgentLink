// 检索打分的唯一口径：先归一化（小写、去掉非字母数字），再按二元组比对。
//
// 这份归一化文本与去重二元组会同时落在 intel 行上（见 searchIndex.js），
// 候选集由 GIN 索引给出，打分仍在内存里做。两处必须用同一套函数：
// 索引命中的内容如果打分不认，就会出现「看得到候选、结果里没有」的静默漏条。

export function compact(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function grams(text) {
  // 二元组按 UTF-16 码元切分，一个非 BMP 字符（emoji、𝕏、扩展 B 汉字）会被劈成两个
  // 落单的代理项。落单代理项不是合法 Unicode：写进 PostgreSQL 时会被替换成 U+FFFD，
  // 于是库里存下来的二元组无法由同一段正文重算出来——派生数据失去可重算性，
  // 审计每次都会报不一致。所以切片之后逐片规整（toWellFormed 把落单代理项换成 U+FFFD），
  // 写入与重算就一致了；成对的字符本身不受影响，仍以整字参与匹配。
  const value = String(text || "");
  const out = [];
  for (let i = 0; i < value.length - 1; i += 1) out.push(value.slice(i, i + 2).toWellFormed());
  return out;
}

// 去重后的二元组：只用来做「有没有碰到」的集合判定，重复不影响结果，却会让索引膨胀。
export function uniqueGrams(text) {
  return [...new Set(grams(text))];
}

// 在一段已经归一化的文本上打分。phrase 与 hay 都必须是 compact() 的结果。
export function scoreCompact(phrase, hay) {
  if (!phrase) return 0;
  if (!hay) return 0;
  if (phrase.length === 1) return hay.includes(phrase) ? 1 : 0;
  const pieces = uniqueGrams(phrase);
  const hits = pieces.filter((piece) => hay.includes(piece)).length;
  if (!hits) return 0;
  // 完整短语命中给高分（短语长度 + 二元组命中数，>= 2）；只有零散二元组命中时返回命中占比（< 1）。
  // 调用方据此区分「完整命中」和「只碰到几个字的弱信号」，后者不再塞满结果。
  if (hay.includes(phrase)) return phrase.length + hits;
  return hits / pieces.length;
}

export function scoreText(query, text) {
  return scoreCompact(compact(query), compact(text));
}
