import assert from "node:assert/strict";
import test from "node:test";
import { WISH_DEFAULT_HOURS, WISH_MAX_HOURS, wishDeadline, wishExpiresAt, wishHours, wishLive } from "./wish.js";

test("a wish lasts 24 hours unless it asks for less", () => {
  assert.equal(WISH_MAX_HOURS, 24);
  assert.equal(wishHours(undefined), WISH_DEFAULT_HOURS);
  assert.equal(wishHours(null), WISH_DEFAULT_HOURS);
  assert.equal(wishHours(""), WISH_DEFAULT_HOURS);
  assert.equal(wishHours("6"), 6);
  assert.equal(wishHours(1), 1);
  assert.equal(wishHours(24), 24);
});

test("a wish cannot outlive 24 hours or last less than one", () => {
  for (const value of [0, -1, 25, 1.5, "2.5", "abc", true]) {
    assert.throws(() => wishHours(value), (error) => error.code === "bad_duration");
  }
});

test("an expiry is counted in hours from now", () => {
  const now = Date.UTC(2026, 9, 17, 0, 0, 0);
  assert.equal(wishExpiresAt(24, now).toISOString(), "2026-10-18T00:00:00.000Z");
  assert.equal(wishExpiresAt(1, now).toISOString(), "2026-10-17T01:00:00.000Z");
});

test("the live filter falls back to 24 hours for wishes written before the column existed", () => {
  const sql = wishLive("i");
  // 没有 expires_at 的旧行也要有到期时刻，否则永远算在有效期内。
  assert.match(sql, /COALESCE\(i\.expires_at, i\.created_at \+ interval '24 hours'\)/);
  assert.equal(sql, `${wishDeadline("i")} > now()`);
  assert.match(sql, /> now\(\)/);
});
