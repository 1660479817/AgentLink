import assert from "node:assert/strict";
import test from "node:test";
import { wishHoursLeft, wishText, wishTo } from "./wishCard.js";

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

test("a wish card shows its words, then its file name", () => {
  assert.equal(wishText({ body: " 找一份手册 " }), "找一份手册");
  assert.equal(wishText({ body: "", images: [{ name: "a.jpg", url: "/x" }] }), "a.jpg");
  assert.equal(wishText({ body: "", images: [{ url: "/x" }], attachments: [{ name: "b.pdf" }] }), "/x");
  assert.equal(wishText({}, "wish"), "wish");
});

test("a wish card opens the lane that fits the author", () => {
  assert.deepEqual(wishTo({ id: "w1", mine: true }), { name: "wish", query: { wish: "w1" } });
  assert.deepEqual(wishTo({ id: "w2", mine: false }), { name: "wish", query: { respond: "w2" } });
});

test("the card counts the hours left, rounding up", () => {
  const expiresAt = new Date(NOW + 90 * 60 * 1000).toISOString();
  assert.equal(wishHoursLeft({ kMeta: { expiresAt } }, NOW), 2);
  const oneHourLeft = new Date(NOW + 1).toISOString();
  assert.equal(wishHoursLeft({ kMeta: { expiresAt: oneHourLeft } }, NOW), 1);
});

test("an expired wish has no hours left, a timeless one has no count", () => {
  const past = new Date(NOW - 1000).toISOString();
  assert.equal(wishHoursLeft({ kMeta: { expiresAt: past } }, NOW), 0);
  assert.equal(wishHoursLeft({}, NOW), null);
});
