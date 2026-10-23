import test from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor, failureRecord, leftoverTotal } from "./failures.mjs";

test("失败档记下退出码、信号与尾部输出", () => {
  const killed = failureRecord({
    scenario: "read",
    vus: 100,
    elapsedMs: 125000,
    status: null,
    signal: "SIGTERM",
    tail: "running\nkilled",
  });
  assert.equal(killed.scenario, "read");
  assert.equal(killed.vus, 100);
  assert.equal(killed.status, null);
  assert.equal(killed.signal, "SIGTERM");
  assert.equal(killed.elapsedMs, 125000);
  assert.equal(killed.reason, "被信号 SIGTERM 终止");
  assert.match(killed.detail, /被信号 SIGTERM 终止/);
  assert.match(killed.detail, /killed/);

  const exited = failureRecord({ scenario: "agent", vus: 50, elapsedMs: 1000, status: 2, tail: "boom" });
  assert.match(exited.detail, /^退出码 2/);
});

test("k6 没写导出文件时用原因覆盖退出码说法", () => {
  const record = failureRecord({
    scenario: "read",
    vus: 5,
    status: 0,
    reason: "k6 退出码 0 但没有写出 --summary-export 文件",
  });
  assert.equal(record.reason, "k6 退出码 0 但没有写出 --summary-export 文件");
  assert.equal(record.detail, "k6 退出码 0 但没有写出 --summary-export 文件");
});

test("有失败档退出码为 1，全部跑成时为 0", () => {
  assert.equal(exitCodeFor({ failed: [{ scenario: "read", vus: 100 }] }), 1);
  assert.equal(exitCodeFor({ failed: [] }), 0);
  assert.equal(exitCodeFor({}), 0);
});

test("写场景留下记录时退出码也是 1，不把它当零痕迹", () => {
  const clean = [{ cleanup: { leftover: 0 } }];
  assert.equal(leftoverTotal(clean), 0);
  assert.equal(exitCodeFor({ failed: [] }, clean), 0);

  const dirty = [{ cleanup: { leftover: 2 } }, { cleanup: { leftover: 1 } }];
  assert.equal(leftoverTotal(dirty), 3);
  // 报告已经写「不是零痕迹」，退出码不跟上的话 CI 仍会当这一轮通过。
  assert.equal(exitCodeFor({ failed: [] }, dirty), 1);
});

test("缺失或非法的 cleanup 不参与计数，也不会把 good run 判成脏", () => {
  assert.equal(leftoverTotal([{}, { cleanup: null }, { cleanup: { leftover: null } }]), 0);
  assert.equal(leftoverTotal([{ cleanup: { leftover: "3" } }]), 3);
  assert.equal(leftoverTotal(undefined), 0);
  assert.equal(exitCodeFor({ failed: [] }, undefined), 0);
});
