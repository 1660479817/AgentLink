import assert from "node:assert/strict";
import test from "node:test";
import { expiryOf, hoursLeftAt, hoursLeftOf, wishDeadlineOf, wishIsLive } from "./record.js";

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

test("a wish is live until its expiry", () => {
  assert.equal(wishIsLive({ kMeta: { expiresAt: new Date(NOW + 1000).toISOString() } }, NOW), true);
  assert.equal(wishIsLive({ kMeta: { expiresAt: new Date(NOW).toISOString() } }, NOW), false);
  assert.equal(wishIsLive({ kMeta: { expiresAt: new Date(NOW - 1000).toISOString() } }, NOW), false);
});

test("a wish without an expiry falls back to 24 hours from creation", () => {
  const created = new Date(NOW - 23 * 60 * 60 * 1000).toISOString();
  assert.equal(wishIsLive({ kMeta: { createdAt: created } }, NOW), true);
  const stale = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
  assert.equal(wishIsLive({ kMeta: { createdAt: stale } }, NOW), false);
});

test("a wish without any timestamps is not hidden", () => {
  assert.equal(wishDeadlineOf({}), null);
  assert.equal(wishIsLive({}, NOW), true);
});

// 只有 wish 和出售帖会失效。免费 post/fastpost 的 expires_at 是空的，
// 不能因为缺这一列就按 24 小时去算。
test("a free post has no expiry at all", () => {
  const created = new Date(NOW - 100 * HOUR).toISOString();
  assert.equal(expiryOf({ kMeta: { kind: "post", createdAt: created } }), null);
  assert.equal(hoursLeftOf({ kMeta: { kind: "fastpost", createdAt: created } }, NOW), null);
});

test("a sale post expires at the time the platform wrote", () => {
  const expiresAt = new Date(NOW + 71 * HOUR).toISOString();
  const item = { kMeta: { kind: "post", expiresAt, createdAt: new Date(NOW - HOUR).toISOString() } };
  assert.equal(expiryOf(item), NOW + 71 * HOUR);
  assert.equal(hoursLeftOf(item, NOW), 71);
});

test("remaining hours round up and stop at zero", () => {
  assert.equal(hoursLeftAt(NOW + 1, NOW), 1);
  assert.equal(hoursLeftAt(NOW + HOUR, NOW), 1);
  assert.equal(hoursLeftAt(NOW + HOUR + 1, NOW), 2);
  assert.equal(hoursLeftAt(NOW, NOW), 0);
  assert.equal(hoursLeftAt(NOW - HOUR, NOW), 0);
  assert.equal(hoursLeftAt(null, NOW), null);
});

test("an expired sale post is reported as expired, not missing", () => {
  const item = { kMeta: { kind: "post", expiresAt: new Date(NOW - 1).toISOString() } };
  assert.equal(hoursLeftOf(item, NOW), 0);
});
