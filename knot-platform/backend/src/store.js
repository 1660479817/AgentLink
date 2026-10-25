import { avatarUrlFor } from "./avatars.js";
import { toRecord } from "./card.js";
import { filesByIntel } from "./information.js";
import { createIntel } from "./intel.js";
import { recordNotification } from "./notifications.js";
import { applyPointsOrdered, walletOf } from "./points.js";

// Knot Store：实例货架。
//
// 一件商品就是一条 kind = 'item' 的 intel 记录，加上 store_items 上的货架状态。
// 内容线（post / fastpost）不经过这里，商品也不进信息流、搜索和公开快照。
//
// 交易只有一笔：买家付出价格，卖家全额收到，平台不抽成。上传的存储成本在发布时
// 已经按字节收过发布服务费，这里不再叠加任何费用。

const ITEM_COLUMNS = `
  i.id, i.body, i.videos, i.links, i.content_hash, i.detail, i.weight, i.price,
  i.category, i.kind, i.is_public, i.verdict, i.reject_reason, i.account_id, i.actor,
  i.created_at, i.updated_at, i.origin_id, i.version,
  u.display_name, u.avatar_upload_id, u.role, u.agent_type,
  s.state, s.listed_at,
  (o.id IS NOT NULL) AS bought
`;

// $1 是查看者所属的钱包，未登录为 NULL。bought 按钱包比：人买过，它的 Agent 也算买过。
const ITEM_FROM = `
  FROM intel i
  JOIN accounts u ON u.id = i.account_id
  JOIN store_items s ON s.intel_id = i.id
  LEFT JOIN store_orders o ON o.item_id = i.id AND o.buyer_id = $1
`;

function notFound() {
  const error = new Error("not_found");
  error.code = "not_found";
  return error;
}

function badState() {
  const error = new Error("bad_state");
  error.code = "bad_state";
  return error;
}

async function viewerWallet(db, userId) {
  if (!userId) return null;
  return walletOf(db, userId);
}

function presentItem(row) {
  const author = {
    id: row.account_id || "",
    name: row.display_name || "",
    avatarUrl: avatarUrlFor(row),
  };
  return {
    ...toRecord(row, { files: row.files || [], author }),
    store: {
      state: row.state || "on_sale",
      listedAt: row.listed_at ? new Date(row.listed_at).toISOString() : null,
      bought: Boolean(row.bought),
      mine: Boolean(row.mine),
    },
  };
}

async function withFiles(pool, rows) {
  if (!rows.length) return [];
  const files = await filesByIntel(pool, rows.map((row) => row.id));
  return rows.map((row) => presentItem({ ...row, files: files.get(row.id) || [] }));
}

// 货架上正在卖的东西。只出已通过终审、状态为 on_sale 的商品：
// 审核中的商品对买家不存在，作者在自己的「我的」里能看到。
export async function listStoreItems(pool, viewerId, { limit = 40, before = null } = {}) {
  const params = [await viewerWallet(pool, viewerId)];
  // mine 按钱包比：Agent 挂的商品也算主人的，货架上不给主人显示购买按钮。
  let sql = `SELECT ${ITEM_COLUMNS}, (COALESCE(u.owner_id, u.id) = $1::uuid) AS mine${ITEM_FROM}
    WHERE s.state = 'on_sale' AND i.verdict = 'passed'`;
  if (before) {
    params.push(before);
    sql += ` AND (s.listed_at, i.id) < (
      SELECT s2.listed_at, s2.intel_id FROM store_items s2 WHERE s2.intel_id = $${params.length}::uuid
    )`;
  }
  params.push(limit);
  sql += ` ORDER BY s.listed_at DESC, i.id DESC LIMIT $${params.length}`;
  const { rows } = await pool.query(sql, params);
  return withFiles(pool, rows);
}

// 我上架的东西，含审核中与已撤下。作者看自己的货架不该被终审状态挡住。
export async function listMyItems(pool, userId, { limit = 40 } = {}) {
  const wallet = await viewerWallet(pool, userId);
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLUMNS}, TRUE AS mine${ITEM_FROM}
      WHERE i.account_id = $2
      ORDER BY s.listed_at DESC, i.id DESC
      LIMIT $3`,
    [wallet, userId, limit]
  );
  return withFiles(pool, rows);
}

export async function loadStoreItem(pool, viewerId, intelId) {
  const wallet = await viewerWallet(pool, viewerId);
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLUMNS}${ITEM_FROM} WHERE i.id = $2 AND s.state = 'on_sale' AND i.verdict = 'passed'`,
    [wallet, intelId]
  );
  if (!rows[0]) return null;
  const presented = await withFiles(pool, rows);
  return presented[0];
}

// 作者看自己的一件东西：任何货架状态都可以，但必须是本人的记录。
export async function loadOwnItem(pool, userId, intelId) {
  const wallet = await viewerWallet(pool, userId);
  const { rows } = await pool.query(
    `SELECT ${ITEM_COLUMNS}, TRUE AS mine${ITEM_FROM} WHERE i.id = $2 AND i.account_id = $3`,
    [wallet, intelId, userId]
  );
  if (!rows[0]) return null;
  const presented = await withFiles(pool, rows);
  return presented[0];
}

// 上架：内容装配全在 intel.createIntel 里，这里只补两件事——
// 强制 kind = 'item'，并在同一个事务里写货架行。
export async function createItem(pool, input) {
  return createIntel(pool, { ...input, kind: "item", isPublic: false }, {
    afterInsert: (client, intelId) =>
      client.query(`INSERT INTO store_items (intel_id) VALUES ($1)`, [intelId]),
  });
}

// 撤下：只动货架状态，不删记录。已经卖出去的订单不受影响，买家仍能取件。
export async function withdrawItem(pool, userId, intelId) {
  const { rows } = await pool.query(
    `UPDATE store_items s
        SET state = 'withdrawn', withdrawn_at = now(), withdrawn_by = $1
       FROM intel i
      WHERE s.intel_id = i.id AND i.id = $2 AND i.account_id = $1 AND s.state = 'on_sale'
      RETURNING s.intel_id`,
    [userId, intelId]
  );
  if (!rows.length) {
    const owned = await pool.query(`SELECT 1 FROM intel WHERE id = $1 AND account_id = $2 AND kind = 'item'`, [
      intelId,
      userId,
    ]);
    throw owned.rows.length ? badState() : notFound();
  }
  return loadOwnItem(pool, userId, intelId);
}

// 重新上架：撤下之后想再卖，不必重发一条。只有作者、只有通过终审的商品能回到货架。
export async function relistItem(pool, userId, intelId) {
  const { rows } = await pool.query(
    `UPDATE store_items s
        SET state = 'on_sale', listed_at = now(), withdrawn_at = NULL, withdrawn_by = NULL
       FROM intel i
      WHERE s.intel_id = i.id AND i.id = $2 AND i.account_id = $1
        AND s.state = 'withdrawn' AND i.verdict = 'passed'
      RETURNING s.intel_id`,
    [userId, intelId]
  );
  if (!rows.length) {
    const owned = await pool.query(`SELECT 1 FROM intel WHERE id = $1 AND account_id = $2 AND kind = 'item'`, [
      intelId,
      userId,
    ]);
    throw owned.rows.length ? badState() : notFound();
  }
  return loadOwnItem(pool, userId, intelId);
}

// 买下一件商品。整笔在一个事务里：锁住商品与货架行，写订单，再动账。
//
// 锁是先商品后积分：两个人互买对方的商品时，各自锁住的商品行不同，动账则统一按
// 钱包 id 排序加锁，不会形成环。价格读的是加锁后的那一行，不是客户端传来的数字。
export async function buyItem(pool, userId, intelId) {
  const buyer = await walletOf(pool, userId);
  if (!buyer) throw notFound();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `SELECT i.id, i.account_id, i.price, i.kind, i.verdict, i.body, s.state
         FROM intel i
         JOIN store_items s ON s.intel_id = i.id
        WHERE i.id = $1
        FOR UPDATE OF i, s`,
      [intelId]
    );
    const item = rows[0];
    if (!item || item.kind !== "item" || item.verdict !== "passed") throw notFound();
    if (item.state !== "on_sale") throw badState();

    const seller = await walletOf(client, item.account_id);
    if (!seller) throw notFound();
    // 自己的东西不买：账号与它名下的 Agent 同属一个钱包。
    if (seller === buyer) throw badState();

    const order = await client.query(
      `INSERT INTO store_orders (item_id, buyer_id, seller_id, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (item_id, buyer_id) DO NOTHING
       RETURNING id, price, created_at`,
      [intelId, buyer, seller, item.price]
    );
    if (!order.rows.length) {
      await client.query("COMMIT");
      return { already: true, price: item.price };
    }
    const price = Number(order.rows[0].price) || 0;
    if (price > 0) {
      // 平台不抽成：买家付出多少，卖家就收到多少，只记两笔。
      await applyPointsOrdered(client, [
        { userId: buyer, delta: -price, reason: "store_buy", refId: intelId },
        { userId: seller, delta: price, reason: "store_sale", refId: intelId },
      ]);
    }
    await client.query("COMMIT");
    // 账已经落定，提醒写不进去也不回滚：卖家下次打开通知仍会看到这次成交。
    try {
      const buyerName = (await pool.query(`SELECT display_name FROM accounts WHERE id = $1`, [buyer])).rows[0]
        ?.display_name;
      await recordNotification(pool, {
        userId: seller,
        kind: "store_sold",
        title: "你的商品卖出去了",
        body: buyerName
          ? `${buyerName} 买走了《${String(item.body || "").slice(0, 40)}》，收入 ${price} 积分`
          : `有人买走了《${String(item.body || "").slice(0, 40)}》，收入 ${price} 积分`,
        href: "/store",
        intelId,
        data: { buyer: buyerName || null, price },
      });
    } catch {
      /* 提醒是附带的，不挡这次成交 */
    }
    return { already: false, price };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.message === "insufficient_points") error.code = "insufficient_points";
    throw error;
  } finally {
    client.release();
  }
}

// 「我买到的」与「我卖出的」。两边都按钱包算，Agent 的成交归到主人名下。
export async function listOrders(pool, userId) {
  const wallet = await viewerWallet(pool, userId);
  const { rows } = await pool.query(
    `SELECT o.id, o.item_id, o.buyer_id, o.seller_id, o.price, o.created_at,
            i.body, i.kind, i.category, i.account_id,
            buyer.display_name AS buyer_name, seller.display_name AS seller_name
       FROM store_orders o
       JOIN intel i ON i.id = o.item_id
       JOIN accounts buyer ON buyer.id = o.buyer_id
       JOIN accounts seller ON seller.id = o.seller_id
      WHERE o.buyer_id = $1 OR o.seller_id = $1
      ORDER BY o.created_at DESC
      LIMIT 100`,
    [wallet]
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    price: Number(row.price) || 0,
    createdAt: new Date(row.created_at).toISOString(),
    side: row.buyer_id === wallet ? "buy" : "sell",
    title: String(row.body || "").slice(0, 120),
    buyer: row.buyer_name || "",
    seller: row.seller_name || "",
  }));
}
