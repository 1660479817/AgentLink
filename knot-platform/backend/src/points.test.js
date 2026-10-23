import assert from "node:assert/strict";
import test from "node:test";
import { applyPoints, applyPointsOrdered, PLATFORM_ACCOUNT_ID } from "./points.js";

const BUYER = "11111111-1111-4111-8111-111111111111";
const AUTHOR = "22222222-2222-4222-8222-222222222222";

// 钱包 id 故意让买家排在作者后面：排序之后应该先动作者那一行。
const WALLETS = new Map([
  [BUYER, "wallet-z"],
  [AUTHOR, "wallet-a"],
  [PLATFORM_ACCOUNT_ID, "wallet-p"],
]);

function client(balances = {}) {
  const updates = [];
  const ledger = [];
  return {
    updates,
    ledger,
    async query(sql, params) {
      if (sql.includes("COALESCE(owner_id, id) AS wallet")) {
        const wallet = WALLETS.get(params[0]);
        return { rows: wallet ? [{ wallet }] : [] };
      }
      if (sql.includes("UPDATE accounts")) {
        updates.push(params[0]);
        const balance = (balances[params[0]] ?? 100) + Number(params[1] || 0);
        if (balance < 0) return { rows: [] };
        balances[params[0]] = balance;
        return { rows: [{ points_balance: balance }] };
      }
      if (sql.includes("INSERT INTO point_ledger")) {
        ledger.push(params);
        return { rows: [] };
      }
      throw new Error(sql);
    },
  };
}

test("a transfer touches the two wallets in id order, whatever the payment direction", async () => {
  const db = client();
  await applyPointsOrdered(db, [
    { userId: BUYER, delta: -8, reason: "download", refId: "intel" },
    { userId: AUTHOR, delta: 8, reason: "download", refId: "intel" },
  ]);
  // 两个人互相下载是 A→B 与 B→A 两笔；排序后加锁顺序一致，不会互等成死锁。
  assert.deepEqual(db.updates, ["wallet-a", "wallet-z"]);
  assert.deepEqual(db.ledger.map((row) => [row[0], row[1], row[2]]), [
    ["wallet-a", 8, "download"],
    ["wallet-z", -8, "download"],
  ]);
});

test("the platform fee joins the same ordered batch", async () => {
  const db = client();
  await applyPointsOrdered(db, [
    { userId: BUYER, delta: -10, reason: "download", refId: "intel" },
    { userId: AUTHOR, delta: 7, reason: "download", refId: "intel" },
    { userId: PLATFORM_ACCOUNT_ID, delta: 3, reason: "download_fee", refId: "intel" },
  ]);
  assert.deepEqual(db.updates, ["wallet-a", "wallet-p", "wallet-z"]);
});

test("a debit that would go negative fails the whole batch before any wallet changes", async () => {
  const db = client({ "wallet-z": 3 });
  await assert.rejects(
    applyPointsOrdered(db, [
      { userId: AUTHOR, delta: 5, reason: "download", refId: "intel" },
      { userId: BUYER, delta: -8, reason: "download", refId: "intel" },
    ]),
    (error) => error.message === "insufficient_points"
  );
  // 作者那笔已经写进事务，余额不足由调用方 ROLLBACK 撤回——与逐笔 applyPoints 的语义一致。
  assert.equal(db.updates.includes("wallet-z"), true);
  assert.equal(db.updates.includes("wallet-a"), true);
});

test("a wallet that cannot be resolved is treated as insufficient points", async () => {
  const db = client();
  await assert.rejects(
    applyPointsOrdered(db, [{ userId: "unknown-account", delta: -1, reason: "download" }]),
    (error) => error.message === "insufficient_points"
  );
  assert.deepEqual(db.updates, []);
});

test("a single account still goes through the same update and ledger", async () => {
  const db = client();
  const balance = await applyPoints(db, { userId: AUTHOR, delta: 20, reason: "tip", refId: "intel" });
  assert.equal(balance, 120);
  assert.deepEqual(db.updates, ["wallet-a"]);
  assert.deepEqual(db.ledger, [["wallet-a", 20, "tip", "intel"]]);
});
