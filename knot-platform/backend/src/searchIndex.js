// 检索索引的组装与回填。
//
// 打分用的归一化文本（search_compact）与去重二元组（search_bigrams）落在 intel 行上，
// 候选集由 GIN 索引给出，不再靠「按权重取前 500 行」的窗口。两列都是派生数据：
// 随时可以由 body、detail、videos 与磁盘上的 extracts 重算，所以回填脚本可以反复跑。

import { toPlain } from "@knot/markdown";
import { loadBootstrapConfig } from "./config.js";
import { readExtract } from "./extracts.js";
import { compact, uniqueGrams } from "./search.js";

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 单行最多索引多少字。附件转写可能很长（一份文档几万字），不设上限会让 GIN 索引膨胀，
// 也会让每次重算变慢。截断对索引和打分同时生效（都在 compact 后的文本上截），
// 所以不会出现「索引里有、打分看不见」的不一致；代价是超长内容的尾部不参与检索。
export const SEARCH_TEXT_MAX = 8000;

function videoText(videos) {
  if (!Array.isArray(videos)) return "";
  return videos
    .map((item) => (typeof item === "string" ? item : item?.url))
    .filter((url) => typeof url === "string" && url)
    .join(" ");
}

// 索引与打分的输入必须是同一段文字：正文、终审的一句、语种、视频链接，加附件转写。
// 展示层用的是 card.toRecord 的另一组字段，这里只负责「能被搜到的那些字」。
export function searchTextOf(row, extract = "") {
  const detail = row?.detail && typeof row.detail === "object" ? row.detail : {};
  const note = typeof detail.note === "string" ? detail.note : "";
  const language = typeof detail.language === "string" ? detail.language : "";
  return [
    toPlain(String(row?.body || "")),
    note,
    language,
    videoText(row?.videos),
    String(extract || ""),
  ]
    .filter((part) => String(part).trim())
    .join(" ")
    .trim();
}

export function searchIndexOf(text) {
  const phrase = compact(text).slice(0, SEARCH_TEXT_MAX);
  return { compact: phrase, bigrams: uniqueGrams(phrase) };
}

// 重算一行。内容、终审结果或附件转写变化后都要调一次。现在的调用点是三处：
// 发布（createIntel）、终审（judgeIntel，放在 finally 里，评审员超时也能算上已写盘的转写）、
// 重打话题标签（retagIntelTopics）。
async function writeSearchIndex(pool, uploadDir, row) {
  // 附件转写在磁盘上，只能逐行读；正文、视频与 detail 由调用方的查询一并带出来，
  // 不再为每一行回表一次（S12-16）。
  const index = searchIndexOf(searchTextOf(row, await readExtract(uploadDir, row.id)));
  await pool.query(
    `UPDATE intel SET search_compact = $2, search_bigrams = $3::text[] WHERE id = $1`,
    [row.id, index.compact, index.bigrams],
  );
  return index;
}

export async function refreshSearchIndex(pool, intelId) {
  if (!ID.test(String(intelId || ""))) return null;
  const { rows } = await pool.query(`SELECT id, body, videos, detail FROM intel WHERE id = $1`, [intelId]);
  const row = rows[0];
  if (!row) return null;
  const { uploadDir } = loadBootstrapConfig();
  return writeSearchIndex(pool, uploadDir, row);
}

export const REINDEX_BATCH = 200;

// 回填存量行。按 id 键集翻页（uuid 有全序），不依赖偏移量，重跑幂等。
// 只算派生列，不改任何业务字段，也不删除数据；回填到一半停下时，
// 未回填的行 search_bigrams 仍为 NULL，检索的兜底条件照样能搜到它们。
// 配置只解析一次、每页一次查询：逐行 SELECT 再逐行 loadBootstrapConfig 会把
// 一次回填变成上万次配置读取。
export async function reindexSearch(pool, { batch = REINDEX_BATCH, onProgress = null } = {}) {
  const { uploadDir } = loadBootstrapConfig();
  let cursor = "";
  let total = 0;
  for (;;) {
    const params = cursor ? [cursor, batch] : [batch];
    const columns = `id, body, videos, detail`;
    const sql = cursor
      ? `SELECT ${columns} FROM intel WHERE id > $1 ORDER BY id LIMIT $2`
      : `SELECT ${columns} FROM intel ORDER BY id LIMIT $1`;
    const { rows } = await pool.query(sql, params);
    if (!rows.length) break;
    for (const row of rows) {
      await writeSearchIndex(pool, uploadDir, row);
      total += 1;
    }
    cursor = rows[rows.length - 1].id;
    if (onProgress) onProgress(total);
    if (rows.length < batch) break;
  }
  // 回填后让计划器重新看一眼前缀：不 ANALYZE，GIN 索引可能不被选中。
  await pool.query(`ANALYZE intel`);
  return total;
}
