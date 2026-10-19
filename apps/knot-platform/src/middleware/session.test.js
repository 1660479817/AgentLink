import assert from "node:assert/strict";
import test from "node:test";
import { sessionTtlMs } from "./session.js";

const DAY = 1000 * 60 * 60 * 24;

test("session lifetime comes from config, defaulting to 30 days", () => {
  assert.equal(sessionTtlMs({}), 30 * DAY);
  assert.equal(sessionTtlMs({ KNOT_SESSION_TTL_DAYS: "7" }), 7 * DAY);
  assert.equal(sessionTtlMs({ KNOT_SESSION_TTL_DAYS: "1.5" }), 1.5 * DAY);
});

test("a broken or non-positive lifetime falls back instead of issuing a dead cookie", () => {
  for (const value of ["", "0", "-3", "thirty", "NaN"]) {
    assert.equal(sessionTtlMs({ KNOT_SESSION_TTL_DAYS: value }), 30 * DAY, `value=${value}`);
  }
});
