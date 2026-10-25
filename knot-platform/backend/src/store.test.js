import assert from "node:assert/strict";
import test from "node:test";
import { buyItem, listStoreItems, relistItem, withdrawItem } from "./store.js";

// 买家与卖家都是人；钱包 id 让买家排在后面，顺带验证动账顺序。
const BUYER = "11111111-1111-4111-8111-111111111111";
const SELLER = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const WALLETS = new Map([
  [BUYER, "wallet-z"],
  [SELLER, "wallet-a"],
]);

// 一个只认得 Store 会发的几条语句的池子：货架行、订单、动账、通知。
function store({ price = 8, state = "on_sale", verdict = "passed", balance = 100, sold = false } = {}) {
  const writes = { orders: [], ledger: [], notes: [], updates: [] };
  const balances = { "wallet-z": balance, "wallet-a": 0 };
  let shelf = state;
  let opened = false;
  async function query(sql, params = []) {
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim())) {
      if (sql.trim() === "BEGIN") opened = true;
      return { rows: [] };
    }
    if (sql.includes("COALESCE(owner_id, id) AS wallet")) {
      const wallet = WALLETS.get(params[0]) ?? (String(params[0]).startsWith("wallet-") ? params[0] : null);
      return { rows: wallet ? [{ wallet }] : [] };
    }
    if (sql.includes("UPDATE store_items")) {
      const next = /SET state = 'withdrawn'/.test(sql) ? "withdrawn" : "on_sale";
      if (next === shelf) return { rows: [] };
      shelf = next;
      return { rows: [{ intel_id: ITEM }] };
    }
    if (sql.includes("i.body, s.state") || sql.includes("FOR UPDATE OF i, s")) {
      return { rows: [{ id: ITEM, account_id: SELLER, price, kind: "item", verdict, body: "手工皮夹", state: shelf }] };
    }
    if (/INSERT INTO store_orders/.test(sql)) {
      if (sold) return { rows: [] };
      writes.orders.push(params);
      return { rows: [{ id: "order-1", price: params[3], created_at: "2026-10-20T00:00:00.000Z" }] };
    }
    if (sql.includes("UPDATE accounts")) {
      const next = (balances[params[0]] ?? 0) + Number(params[1] || 0);
      if (next < 0) return { rows: [] };
      balances[params[0]] = next;
      writes.updates.push(params[0]);
      return { rows: [{ points_balance: next }] };
    }
    if (sql.includes("INSERT INTO point_ledger")) {
      writes.ledger.push(params);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO notifications")) {
      writes.notes.push(params);
      return { rows: [{ id: "n1" }] };
    }
    if (sql.includes("SELECT display_name FROM accounts")) {
      return { rows: [{ display_name: "阿蓝" }] };
    }
    if (sql.includes("FROM intel_files")) return { rows: [] };
    if (sql.includes("SELECT 1 FROM intel WHERE id = $1")) {
      return { rows: params[1] === SELLER ? [{ "?column?": 1 }] : [] };
    }
    if (sql.includes("TRUE AS mine")) {
      return {
        rows: [{ id: ITEM, account_id: SELLER, price, kind: "item", verdict, body: "手工皮夹", state: shelf, listed_at: null }],
      };
    }
    throw new Error(`unexpected sql: ${sql}`);
  }
  return {
    writes,
    balances,
    wasOpened: () => opened,
    pool: { query, connect: async () => ({ query, release() {} }) },
  };
}

test("a sale moves the whole price to the seller, with no platform cut", async () => {
  const db = store({ price: 8 });
  const result = await buyItem(db.pool, BUYER, ITEM);
  assert.deepEqual(result, { already: false, price: 8 });
  assert.equal(db.balances["wallet-z"], 92);
  assert.equal(db.balances["wallet-a"], 8);
  // 两笔正好抵平：没有第三笔服务费，平台不在这场交易里抽走任何积分。
  assert.deepEqual(
    db.writes.ledger.map((row) => [row[0], row[1], row[2]]),
    [
      ["wallet-a", 8, "store_sale"],
      ["wallet-z", -8, "store_buy"],
    ]
  );
  assert.equal(db.writes.orders[0][3], 8, "订单按加锁后读到的价格记账");
});

test("the seller is told once, and the notice does not block the sale", async () => {
  const db = store();
  await buyItem(db.pool, BUYER, ITEM);
  assert.equal(db.writes.notes.length, 1);
  assert.equal(db.writes.notes[0][1], "store_sold");
  assert.equal(db.writes.notes[0][5], ITEM);

  const broken = store();
  broken.pool.query = (sql, params) => {
    if (sql.includes("INSERT INTO notifications")) return Promise.reject(new Error("db down"));
    return db.pool.query(sql, params);
  };
  assert.deepEqual(await buyItem(broken.pool, BUYER, ITEM), { already: false, price: 8 });
});

test("a second purchase of the same item is not charged again", async () => {
  const db = store({ sold: true });
  assert.deepEqual(await buyItem(db.pool, BUYER, ITEM), { already: true, price: 8 });
  assert.equal(db.writes.ledger.length, 0);
});

test("buying your own item, or an item off the shelf, is refused", async () => {
  await assert.rejects(buyItem(store().pool, SELLER, ITEM), (error) => error.code === "bad_state");
  await assert.rejects(buyItem(store({ state: "withdrawn" }).pool, BUYER, ITEM), (error) => error.code === "bad_state");
  // 没通过终审的商品对买家不存在。
  await assert.rejects(buyItem(store({ verdict: "pending" }).pool, BUYER, ITEM), (error) => error.code === "not_found");
});

test("too few points fails the purchase before anything else happens", async () => {
  const db = store({ price: 500 });
  await assert.rejects(buyItem(db.pool, BUYER, ITEM), (error) => error.code === "insufficient_points");
  // 卖家不该为一次没付款的订单收到提醒。
  assert.equal(db.writes.notes.length, 0);
});

test("the shelf only lists items on sale that passed review", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("COALESCE(owner_id")) return { rows: [{ wallet: "wallet-z" }] };
      return { rows: [] };
    },
  };
  await listStoreItems(pool, BUYER, { limit: 10 });
  assert.match(calls[1].sql, /s\.state = 'on_sale'/);
  assert.match(calls[1].sql, /i\.verdict = 'passed'/);
  // 自己的商品在货架上也要标成 mine：否则主人会看到购买按钮，点下去才被服务端拒绝。
  assert.match(calls[1].sql, /AS mine/);
  assert.deepEqual(calls[1].params, ["wallet-z", 10]);
});

test("withdrawing and relisting only touch the shelf row", async () => {
  const db = store();
  assert.equal((await withdrawItem(db.pool, SELLER, ITEM)).store.state, "withdrawn");
  // 已经下架的不能再下架，还在架上的不能重新上架：都是状态不对，不是找不到。
  await assert.rejects(withdrawItem(db.pool, SELLER, ITEM), (error) => error.code === "bad_state");
  assert.equal((await relistItem(db.pool, SELLER, ITEM)).store.state, "on_sale");
  await assert.rejects(relistItem(db.pool, SELLER, ITEM), (error) => error.code === "bad_state");
});
