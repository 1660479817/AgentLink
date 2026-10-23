import test from "node:test";
import assert from "node:assert/strict";
import { isDirectHost } from "./net.mjs";

// 直连判定只留这一处。以前 run.mjs 认私网、probe.mjs 只认回环，
// 直接探测 192.168.3.91 会被报成「管理入口泄漏到公网」。

test("回环地址算直连", () => {
  for (const host of ["127.0.0.1", "127.1.2.3", "localhost", "localhost.", "::1", "[::1]"]) {
    assert.equal(isDirectHost(host), true, host);
  }
});

test("RFC 1918 私网段算直连", () => {
  for (const host of ["10.0.0.1", "10.255.255.254", "192.168.3.91", "172.16.0.1", "172.31.255.1"]) {
    assert.equal(isDirectHost(host), true, host);
  }
});

test("172.32 与公网域名不算直连", () => {
  for (const host of ["172.32.0.1", "172.15.0.1", "8.8.8.8", "wang.xknot.si", "54.169.33.64"]) {
    assert.equal(isDirectHost(host), false, host);
  }
});

test("大小写与空值不会误判成直连", () => {
  assert.equal(isDirectHost("LOCALHOST"), true);
  assert.equal(isDirectHost(""), false);
  assert.equal(isDirectHost(undefined), false);
});
