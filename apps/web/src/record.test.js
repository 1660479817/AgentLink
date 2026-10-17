import assert from "node:assert/strict";
import test from "node:test";
import { wishDeadlineOf, wishIsLive } from "./record.js";

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

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
