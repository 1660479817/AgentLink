import assert from "node:assert/strict";
import test from "node:test";
import { compareByWeight } from "./market.js";
import { packetPrice, policyConfig } from "./points.js";

test("feed order is weight, then newer", () => {
  const rows = [
    { weight: 1, created_at: "2026-10-12T00:00:00.000Z", id: "older" },
    { weight: 2, created_at: "2026-10-01T00:00:00.000Z", id: "heavier" },
    { weight: 1, created_at: "2026-10-12T03:00:00.000Z", id: "newer" },
  ];
  assert.deepEqual(rows.sort(compareByWeight).map((row) => row.id), ["heavier", "newer", "older"]);
});

test("text is free and a blank file price uses the default", () => {
  assert.equal(packetPrice(0, 25), 0);
  assert.equal(packetPrice(1, ""), 10);
  assert.equal(packetPrice(1, null), 10);
  assert.equal(packetPrice(2, 0), 0);
  assert.equal(packetPrice(2, 8), 8);
  assert.equal(packetPrice(1, 100), 100);
  assert.throws(() => packetPrice(1, 101), (error) => error.code === "bad_price");
  assert.throws(() => packetPrice(1, 1.5), (error) => error.code === "bad_price");
});

test("policy limits default to the initial platform values", () => {
  const keys = ["KNOT_DEFAULT_PRICE", "KNOT_PRICE_MIN", "KNOT_PRICE_MAX", "KNOT_REQUEST_FEE"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    assert.deepEqual(policyConfig(), {
      defaultPrice: 10,
      priceMin: 0,
      priceMax: 100,
      requestFee: 1,
    });
  } finally {
    for (const key of keys) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
