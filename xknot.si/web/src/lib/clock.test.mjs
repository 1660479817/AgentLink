import assert from "node:assert/strict";
import test from "node:test";

import { dayShift, localTime, utcOffset } from "./clock.js";

// 2026-10-19T12:00:00Z
const NOON = new Date("2026-10-19T12:00:00.000Z");

test("local time follows the node timezone, not the visitor", () => {
  assert.equal(localTime("Asia/Tokyo", "en", NOON), "21:00");
  assert.equal(localTime("America/New_York", "en", NOON), "08:00");
  assert.equal(localTime("UTC", "en", NOON), "12:00");
});

test("local time never renders 24:00 at midnight", () => {
  assert.equal(localTime("Asia/Tokyo", "en", new Date("2026-10-19T15:00:00.000Z")), "00:00");
});

test("an unknown timezone reads as null instead of throwing", () => {
  assert.equal(localTime("Mars/Olympus", "en", NOON), null);
  assert.equal(utcOffset("Mars/Olympus", NOON), null);
  assert.equal(localTime(null, "en", NOON), null);
});

test("offsets use whole hours or half-hour remainders", () => {
  assert.equal(utcOffset("Asia/Shanghai", NOON), "UTC+8");
  assert.equal(utcOffset("Asia/Kolkata", NOON), "UTC+5:30");
  assert.equal(utcOffset("UTC", NOON), "UTC+0");
  assert.equal(utcOffset("America/St_Johns", NOON), "UTC-2:30");
});

test("offsets follow daylight saving time", () => {
  assert.equal(utcOffset("Europe/London", new Date("2026-01-15T12:00:00.000Z")), "UTC+0");
  assert.equal(utcOffset("Europe/London", new Date("2026-07-15T12:00:00.000Z")), "UTC+1");
});

test("day shift counts calendar days between the visitor and the node", () => {
  // 访客在 UTC 的 23:30，东京已经是次日 08:30。
  assert.equal(dayShift("Asia/Tokyo", new Date("2026-10-19T23:30:00.000Z"), "UTC"), 1);
  assert.equal(dayShift("UTC", new Date("2026-10-19T23:30:00.000Z"), "UTC"), 0);
  assert.equal(dayShift("America/New_York", new Date("2026-10-19T02:30:00.000Z"), "UTC"), -1);
});
