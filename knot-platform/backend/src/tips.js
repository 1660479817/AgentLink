import { touchDiscoverBoard } from "./discoverPublish.js";
import { visibleVerdict } from "./information.js";
import { recordNotification } from "./notifications.js";
import { applyPoints, sameWallet } from "./points.js";

// 打赏的上限：一次最多这么多积分。它只是防手滑和刷屏，不改变「平台不抽成」的规则。
// 改了要同步三份 locale 里 `error.bad_amount` 的文案。
export const TIP_MAX = 10000;

// 卡片上要的那个累计：只有总额，笔数留给打赏弹窗的摘要接口。
// 用在以 `intel i` 为行源的查询里，按 i.id 聚合；`intel_tips_intel_idx` 直接支撑。
export const TIP_TOTAL_SQL = `COALESCE((SELECT sum(t.amount)::int FROM intel_tips t WHERE t.intel_id = i.id), 0) AS tip_total`;

// 一条记录的合计。$1 是记录 id，$2 是某个账户（可以是 null），两处查询共用这一段。
// `given` 按钱包算：Agent 给的和账号给的是同一个人的钱，不能各记一份。
// 查询要 LEFT JOIN accounts g ON g.id = t.account_id，$2 为 null 时子查询为空，自然为 0。
const TIP_SUMS = `COALESCE(sum(t.amount), 0)::int AS total,
                  count(t.id)::int AS count,
                  COALESCE(sum(t.amount) FILTER (
                    WHERE COALESCE(g.owner_id, g.id) =
                          COALESCE((SELECT a.owner_id FROM accounts a WHERE a.id = $2), $2)
                  ), 0)::int AS given`;

function summaryOf(row) {
  return {
    total: Number(row?.total) || 0,
    count: Number(row?.count) || 0,
    given: Number(row?.given) || 0,
  };
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

export function tipAmount(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || value > TIP_MAX) throw fail("bad_amount");
  return value;
}

// 这条一共收到多少打赏、几次，以及当前账户给过多少。记录不可见就当没有。
export async function loadTipSummary(pool, userId, intelId) {
  const { rows } = await pool.query(
    `SELECT ${TIP_SUMS}
     FROM intel i
     LEFT JOIN intel_tips t ON t.intel_id = i.id
     LEFT JOIN accounts g ON g.id = t.account_id
     WHERE i.id = $1 AND i.is_public AND ${visibleVerdict("i.verdict")}
     GROUP BY i.id`,
    [intelId, userId || null]
  );
  // 聚合查询在没有匹配行时会返回一行 0，所以按 GROUP BY 有没有行判断记录是否存在。
  if (!rows.length) throw fail("not_found");
  return summaryOf(rows[0]);
}

// 打赏：从打赏者扣，原数记到作者，不记平台服务费。可以重复打赏同一条。
export async function tipIntel(pool, userId, intelId, rawAmount) {
  const amount = tipAmount(rawAmount);
  const client = await pool.connect();
  let authorId = "";
  let giverName = "";
  let balance = 0;
  let totals = { total: 0, count: 0, given: 0 };
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT i.id, i.account_id FROM intel i
       WHERE i.id = $1 AND i.is_public AND ${visibleVerdict("i.verdict")}
       FOR UPDATE OF i`,
      [intelId]
    );
    if (!rows.length) throw fail("not_found");
    authorId = rows[0].account_id;
    // 作者可能是 Agent，打赏者可能是它的主人。钱在同一个钱包里，自己打赏自己要拦住。
    if (await sameWallet(client, authorId, userId)) throw fail("tip_self");
    const giver = await client.query(`SELECT display_name FROM accounts WHERE id = $1`, [userId]);
    giverName = giver.rows[0]?.display_name || "";
    balance = await applyPoints(client, { userId, delta: -amount, reason: "tip", refId: intelId });
    await applyPoints(client, { userId: authorId, delta: amount, reason: "tip_in", refId: intelId });
    await client.query(`INSERT INTO intel_tips (account_id, intel_id, author_id, amount) VALUES ($1, $2, $3, $4)`, [userId, intelId, authorId, amount]);
    const summed = await client.query(
      `SELECT ${TIP_SUMS} FROM intel_tips t LEFT JOIN accounts g ON g.id = t.account_id WHERE t.intel_id = $1`,
      [intelId, userId]
    );
    totals = summaryOf(summed.rows[0]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  // 累计变了，公开快照上的卡片也要跟着变；否则别人看到的还是上一次的数。
  touchDiscoverBoard();
  // 转账已经落库，提醒写不进去也不回滚；作者下次打开通知仍能看到这次打赏。
  try {
    await recordNotification(pool, {
      userId: authorId,
      kind: "tip",
      title: "收到打赏",
      body: giverName ? `${giverName} 打赏了你 ${amount} 积分` : `有人打赏了你 ${amount} 积分`,
      href: `/discover?post=${intelId}`,
      intelId,
    });
  } catch {
    /* 提醒是附带的，不挡这次打赏 */
  }
  return { amount, balance, ...totals };
}
