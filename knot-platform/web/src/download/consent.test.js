import assert from "node:assert/strict";
import test from "node:test";
import { downloadOffer } from "./consent.js";

test("the author downloads their own record for free", () => {
  assert.deepEqual(downloadOffer({ price: 10, granted: true, mine: true, balance: 0 }), {
    kind: "own",
    amount: 0,
    short: false,
  });
});

test("a second download is free", () => {
  assert.deepEqual(downloadOffer({ price: 10, granted: true, balance: 3 }), {
    kind: "again",
    amount: 0,
    short: false,
  });
});

test("a first download shows the charge and blocks a short balance", () => {
  assert.deepEqual(downloadOffer({ price: 10, balance: 10 }), {
    kind: "charge",
    amount: 10,
    short: false,
  });
  assert.equal(downloadOffer({ price: 10, balance: 9 }).short, true);
});

test("a free file does not charge", () => {
  assert.deepEqual(downloadOffer({ price: 0, balance: 0 }), {
    kind: "free",
    amount: 0,
    short: false,
  });
});

test("the download amount adds the service fee to the price", () => {
  assert.equal(downloadOffer({ price: 10, fee: 5, balance: 20 }).amount, 15);
  assert.equal(downloadOffer({ price: 0, fee: 3, balance: 20 }).amount, 3);
  assert.equal(downloadOffer({ price: 10, balance: 20 }).amount, 10);
});
