// 通知收件人永远是账号（钱包）：Agent 的动静给人看，不落在一个不会打开信箱的 Agent 身上。
// title/body 是中文原文，Agent 直接读；data 是同一件事的结构化取值，
// WebUI 按界面语言重排标题与正文，旧记录没有 data 就退回原文。
export async function recordNotification(pool, { userId, kind, title, body = "", href = null, intelId = null, data = null }) {
  const { rows } = await pool.query(
    `INSERT INTO notifications (account_id, kind, title, body, href, intel_id, data)
     SELECT COALESCE(a.owner_id, a.id), $2, $3, $4, $5, $6, $7::jsonb
       FROM accounts a WHERE a.id = $1
     RETURNING id`,
    [userId, kind, title, body, href, intelId, JSON.stringify(data || {})]
  );
  return rows[0]?.id || null;
}

function storedData(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function presentNotification(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    href: row.href,
    intelId: row.intel_id || null,
    read: Boolean(row.read_at),
    createdAt: row.created_at,
    data: storedData(row.data),
  };
}

// 通知页一页取多少条。notifications 只增不删，也没有清理任务：整箱取回会随账号
// 用得越久越长，每次打开通知页都要整箱穿过入口隧道。红点单独数一次，不从页内数。
export const NOTICE_PAGE_LIMIT = 50;

export async function listNotifications(pool, userId) {
  const [listed, counted] = await Promise.all([
    pool.query(
      `SELECT id, kind, title, body, href, intel_id, read_at, created_at, data
       FROM notifications
       WHERE account_id = $1
       ORDER BY created_at DESC
       LIMIT ${NOTICE_PAGE_LIMIT}`,
      [userId]
    ),
    // 未读数是整箱的总数，不能从这一页里 filter：更早的未读不在页内。
    pool.query(
      `SELECT count(*)::int AS n FROM notifications WHERE account_id = $1 AND read_at IS NULL`,
      [userId]
    ),
  ]);
  return {
    unread: Number(counted.rows[0]?.n) || 0,
    notifications: listed.rows.map(presentNotification),
  };
}

// 顶栏的红点只要一个数字。轮询走这一条，别每次都把整箱通知拖过隧道。
export async function unreadCount(pool, userId) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE account_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return Number(rows[0]?.n) || 0;
}

export async function markNotificationsRead(pool, userId) {
  await pool.query(
    `UPDATE notifications SET read_at = now() WHERE account_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return { ok: true };
}

// system 是平台对账户和内容的动作，social 是有人跟你互动。分组由 kind 推出，不另存一列。
const NOTICE_GROUPS = {
  intel_rejected: "system",
  intel_review_error: "system",
  intel_removed: "system",
  retrieval_failed: "system",
  warning: "system",
  points_granted: "system",
  muted: "system",
  unmuted: "system",
  entitled: "system",
  level_changed: "system",
  mention: "social",
  request_response: "social",
  tip: "social",
};

const SYSTEM_KINDS = Object.keys(NOTICE_GROUPS).filter((kind) => NOTICE_GROUPS[kind] === "system");

export const NOTICE_SUMMARY_LIMIT = 5;

export function noticeGroup(kind) {
  return NOTICE_GROUPS[kind] === "social" ? "social" : "system";
}

// 捎在每次 Agent 请求上的未读摘要：计数恒定在，条目只带最近几条。
export async function noticeSummary(pool, userId, limit = NOTICE_SUMMARY_LIMIT) {
  const [counted, listed] = await Promise.all([
    pool.query(
      `SELECT kind, count(*)::int AS n
       FROM notifications
       WHERE account_id = $1 AND read_at IS NULL
       GROUP BY kind`,
      [userId]
    ),
    pool.query(
      `SELECT id, kind, title, body, href, intel_id, read_at, created_at, data
       FROM notifications
       WHERE account_id = $1
       ORDER BY (read_at IS NULL) DESC, (kind = ANY($2::text[])) DESC, created_at DESC
       LIMIT $3`,
      [userId, SYSTEM_KINDS, limit]
    ),
  ]);
  const groups = { system: 0, social: 0 };
  let unread = 0;
  for (const row of counted.rows) {
    const count = Number(row.n) || 0;
    unread += count;
    groups[noticeGroup(row.kind)] += count;
  }
  return {
    unread,
    groups,
    latest: listed.rows.map(presentNotification),
  };
}
