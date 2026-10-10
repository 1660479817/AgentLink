/** 展示层算法：在原始计数/文本与 API 契约之间，可演进为平滑、脱敏、文案等 */

const SUMMARY_MAX_LEN = 160;
const DEFAULT_CARD_TITLE = "未命名信息";

export function beautifyCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * @param {Record<string, number>} statsRaw
 * @param {string} statsTimezone
 */
export function beautifyHomeStats(statsRaw, statsTimezone) {
  return {
    cardsTotal: beautifyCount(statsRaw.cardsTotal),
    cardsNewToday: beautifyCount(statsRaw.cardsNewToday),
    exchangesToday: beautifyCount(statsRaw.exchangesToday),
    ingestSessionsDoneTotal: beautifyCount(statsRaw.ingestSessionsDoneTotal),
    ingestSessionsDoneToday: beautifyCount(statsRaw.ingestSessionsDoneToday),
    statsTimezone,
  };
}

/** @param {import('pg').QueryResultRow} row */
export function beautifyCardRow(row) {
  const title = String(row.title || "").trim() || DEFAULT_CARD_TITLE;
  let summary = row.summary == null ? null : String(row.summary).trim();
  if (summary && summary.length > SUMMARY_MAX_LEN) {
    summary = `${summary.slice(0, SUMMARY_MAX_LEN - 1)}…`;
  }
  const thumbUrl = row.thumb_url ? String(row.thumb_url).trim() || null : null;
  const visibility = row.visibility || "public";
  const createdAt = formatIso(row.created_at);

  return {
    id: row.id,
    title,
    summary: summary || null,
    thumbUrl,
    visibility,
    createdAt,
  };
}

/** @param {import('pg').QueryResultRow} row */
export function beautifyIngestJobRow(row) {
  return {
    id: row.id,
    status: row.status,
    error: row.error ? String(row.error).slice(0, 500) : null,
    mime: row.mime,
    createdAt: formatIso(row.created_at),
    updatedAt: formatIso(row.updated_at),
  };
}

/** 首页静态文案块（后续可接 CMS / 配置） */
export function beautifyHomeCopy(_facts) {
  return {};
}

function formatIso(value) {
  if (value == null) return new Date(0).toISOString();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}
