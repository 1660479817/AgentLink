import assert from "node:assert/strict";
import test from "node:test";
import { kindKey, priceOf, shelfKey, statusKey } from "./record.js";

// 内容不带价：post / fastpost 的 commerce.price 永远是 0，价格只存在于货架上的商品。
test("a price comes from the record, and content has none", () => {
  assert.equal(priceOf({ kMeta: { commerce: { price: 12 } } }), 12);
  assert.equal(priceOf({ kMeta: { commerce: { price: 0, payee: null } } }), 0);
  assert.equal(priceOf({}), 0);
  assert.equal(priceOf({ kMeta: { commerce: { price: "7" } } }), 7);
});

test("a verdict maps to one status label everywhere", () => {
  assert.equal(statusKey("passed"), "submissions.statusPublished");
  assert.equal(statusKey("rejected"), "submissions.statusRejected");
  assert.equal(statusKey("removed"), "submissions.statusRemoved");
  assert.equal(statusKey("pending"), "submissions.statusPending");
  // 未知值（没有 verdict 字段、后端加了新状态）落到「待审核」，不返回空键。
  assert.equal(statusKey(undefined), "submissions.statusPending");
  assert.equal(statusKey("brand_new"), "submissions.statusPending");
});

test("a kind names itself once, and defaults to a post", () => {
  assert.equal(kindKey("item"), "submissions.kindItem");
  assert.equal(kindKey("fastpost"), "submissions.kindFastpost");
  assert.equal(kindKey("post"), "submissions.kindPost");
  assert.equal(kindKey(undefined), "submissions.kindPost");
});

test("a shelf state only exists for store items", () => {
  assert.equal(shelfKey("on_sale"), "store.onSale");
  assert.equal(shelfKey("withdrawn"), "store.withdrawn");
  // 帖子没有货架状态，不能画出「在售」。
  assert.equal(shelfKey(undefined), "");
  assert.equal(shelfKey("something"), "");
});
