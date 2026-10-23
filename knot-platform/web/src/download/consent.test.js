import assert from "node:assert/strict";
import test from "node:test";
import { acceptDownload, dismissDownload, downloadConsent, downloadOffer, settleDownload } from "./consent.js";

// 这些用例驱动的是「扣多少、扣没扣」那条状态机：确认 → 执行 → 完成/失败。
// 它不依赖组件，所以直接在 node --test 里跑。

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

// 等一轮宏任务：任务本身是 async，phase 要等它回来才翻页。
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("confirming runs the task once and ends in done", async () => {
  let runs = 0;
  const pending = acceptDownload({ price: 10, balance: 20, task: async () => { runs += 1; } });
  assert.equal(downloadConsent.value.phase, "confirm");
  assert.equal(downloadConsent.value.amount, 10);
  settleDownload(true);
  assert.equal(downloadConsent.value.phase, "working");
  await tick();
  assert.equal(runs, 1);
  assert.equal(downloadConsent.value.phase, "done");
  // 完成态要等用户关窗，promise 也在那时才结算。
  dismissDownload();
  assert.equal(await pending, true);
  assert.equal(downloadConsent.value, null);
});

test("cancelling resolves false and never runs the task", async () => {
  let runs = 0;
  const pending = acceptDownload({ price: 10, balance: 20, task: async () => { runs += 1; } });
  settleDownload(false);
  assert.equal(await pending, false);
  assert.equal(runs, 0);
  assert.equal(downloadConsent.value, null);
});

test("a failing task ends in error and keeps its code", async () => {
  const pending = acceptDownload({
    price: 10,
    balance: 20,
    task: async () => {
      const error = new Error("nope");
      error.code = "insufficient_points";
      throw error;
    },
  });
  settleDownload(true);
  await tick();
  assert.equal(downloadConsent.value.phase, "error");
  assert.equal(downloadConsent.value.code, "insufficient_points");
  dismissDownload();
  assert.equal(await pending, false);
  assert.equal(downloadConsent.value, null);
});

test("a short balance is reported instead of hanging on confirm", async () => {
  const pending = acceptDownload({ price: 10, balance: 3, task: async () => {} });
  assert.equal(downloadConsent.value.short, true);
  settleDownload(true);
  // 不能停在 confirm：否则确认键禁用、用户也没有任何提示。
  assert.equal(downloadConsent.value.phase, "error");
  assert.equal(downloadConsent.value.code, "insufficient_points");
  dismissDownload();
  assert.equal(await pending, false);
});

test("a second download closes the first one instead of opening two dialogs", async () => {
  const first = acceptDownload({ price: 10, balance: 20, task: async () => {} });
  const second = acceptDownload({ price: 5, balance: 20, task: async () => {} });
  assert.equal(await first, false);
  assert.equal(downloadConsent.value.amount, 5);
  settleDownload(false);
  assert.equal(await second, false);
  assert.equal(downloadConsent.value, null);
});

test("an error handed in up front never shows a confirm step", async () => {
  const pending = acceptDownload({ code: "packet_unavailable" });
  assert.equal(downloadConsent.value.phase, "error");
  assert.equal(downloadConsent.value.code, "packet_unavailable");
  dismissDownload();
  assert.equal(await pending, false);
  assert.equal(downloadConsent.value, null);
});
