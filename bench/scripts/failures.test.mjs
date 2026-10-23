import test from "node:test";
import assert from "node:assert/strict";
import { exitCodeFor, failureRecord } from "./failures.mjs";

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
