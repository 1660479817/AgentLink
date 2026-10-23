import { visibleVerdict } from "./information.js";

// 筛选栏的候选维度：从最近 7 天公开 post/fastpost 里统计类别与话题标签。
// 阈值动态取频次中位数，而不是固定数字：冷启动时中位数低，长尾话题不会
// 永远够不到门槛；数据多了中位数自然升高，把只有零星一两条的噪声滤掉。
// 调用方仍可显式给 categoryMin / topicMin 覆盖（测试和特殊窗口用）。
//
// 计数在库里做完再回来：原先取回 7 天内每一行的 detail 在 Node 里数，
// 窗口大小直接变成每次请求的内存与跨境流量（S11-08）。现在只回聚合行。
const FACET_SQL = `
  SELECT kind, value, n FROM (
    SELECT 'category' AS kind, i.category AS value, count(*)::int AS n
      FROM intel i
     WHERE i.kind IN ('post', 'fastpost')
       AND i.is_public
       AND ${visibleVerdict("i.verdict")}
       AND i.created_at > now() - interval '7 days'
     GROUP BY i.category
    UNION ALL
    SELECT 'topic' AS kind,
           t.topic AS value,
           count(*)::int AS n
      FROM intel i
      CROSS JOIN LATERAL jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(i.detail -> 'topics') = 'array' THEN i.detail -> 'topics' ELSE '[]'::jsonb END
      ) AS t(topic)
     WHERE i.kind IN ('post', 'fastpost')
       AND i.is_public
       AND ${visibleVerdict("i.verdict")}
       AND i.created_at > now() - interval '7 days'
     GROUP BY t.topic
  ) counts
  -- 上限只防长尾把响应撑大；中位数按取回的这一段算，和原先同一窗口的数量级一致。
  LIMIT 500
`;

function bump(map, value) {
  const key = String(value ?? "").trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

// 动态阈值：频次中位数，至少 1。条目数少于等于 1 时全列。
function medianMin(counts) {
  if (counts.length <= 1) return 1;
  const sorted = [...counts].sort((a, b) => a - b);
  return Math.max(1, sorted[Math.floor(sorted.length / 2)]);
}

function rank(map, min) {
  // 先按频次，频次相同时按码点，保证顺序稳定。
  const entries = [...map.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const threshold = min == null ? medianMin(entries.map(([, count]) => count)) : min;
  return entries.filter(([, count]) => count >= threshold).map(([value]) => value);
}

export function facetRows(rows, { categoryMin, topicMin } = {}) {
  const categories = new Map();
  const topics = new Map();
  for (const row of rows) {
    bump(categories, row.category);
    const detail = row.detail && typeof row.detail === "object" ? row.detail : {};
    for (const topic of Array.isArray(detail.topics) ? detail.topics : []) bump(topics, topic);
  }
  return {
    categories: rank(categories, categoryMin),
    topics: rank(topics, topicMin),
  };
}

// 库里已经数好的行（kind / value / n）→ 同一份结果。
export function facetCounts(rows, { categoryMin, topicMin } = {}) {
  const categories = new Map();
  const topics = new Map();
  for (const row of rows || []) {
    const count = Number(row.n) || 0;
    if (!count) continue;
    const map = row.kind === "topic" ? topics : categories;
    const value = String(row.value ?? "").trim();
    if (!value) continue;
    map.set(value, (map.get(value) || 0) + count);
  }
  return {
    categories: rank(categories, categoryMin),
    topics: rank(topics, topicMin),
  };
}

export async function listFacets(pool) {
  const { rows } = await pool.query(FACET_SQL);
  return facetCounts(rows);
}
