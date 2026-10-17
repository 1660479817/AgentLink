import { visibleVerdict } from "./information.js";

// 筛选栏的候选维度：从最近 7 天公开 post/fastpost 里统计类别与话题标签。
// 不开 30 条的快照窗，否则选项太稀疏。
// 只展示超过阈值的项，滤掉只有一两条的长尾。
export const CATEGORY_MIN = 5;
export const TOPIC_MIN = 2;

const FACETS_SQL = `
  SELECT i.category, i.detail
  FROM intel i
  WHERE i.kind IN ('post', 'fastpost')
    AND i.is_public
    AND ${visibleVerdict("i.verdict")}
    AND i.created_at > now() - interval '7 days'
`;

function bump(map, value) {
  const key = String(value ?? "").trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function sorted(map, min) {
  // 先按频次，频次相同时按码点，保证顺序稳定；只保留达到阈值的项。
  return [...map.entries()]
    .filter(([, count]) => count >= min)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([value]) => value);
}

export function facetRows(rows, { categoryMin = CATEGORY_MIN, topicMin = TOPIC_MIN } = {}) {
  const categories = new Map();
  const topics = new Map();
  for (const row of rows) {
    bump(categories, row.category);
    const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
    for (const topic of Array.isArray(detail.topics) ? detail.topics : []) bump(topics, topic);
  }
  return {
    categories: sorted(categories, categoryMin),
    topics: sorted(topics, topicMin),
  };
}

export async function listFacets(pool) {
  const { rows } = await pool.query(FACETS_SQL);
  return facetRows(rows);
}
