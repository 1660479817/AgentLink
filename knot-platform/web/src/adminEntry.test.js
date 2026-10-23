import assert from "node:assert/strict";
import test from "node:test";
import { adminEntryState, adminUrl, isIntranetHost } from "./adminEntry.js";

test("内网判断与后端同口径", () => {
  for (const host of ["127.0.0.1", "127.5.0.1", "localhost", "::1", "10.0.0.7", "172.16.0.9", "172.31.255.1", "192.168.1.10", "169.254.1.1", "fc00::1", "fe80::1", "[::1]"]) {
    assert.equal(isIntranetHost(host), true, host);
  }
  for (const host of ["cpswang.xknot.si", "8.8.8.8", "172.32.0.1", "192.169.0.1", "", "example.com", "2001:db8::1"]) {
    assert.equal(isIntranetHost(host), false, host);
  }
});

test("本页就开在内网地址上时，优先用同一个 origin", () => {
  const state = adminEntryState({
    hosts: ["http://192.168.1.10:8080"],
    pageOrigin: "http://192.168.1.10:8080",
  });
  assert.equal(state.primary, "http://192.168.1.10:8080");
  assert.deepEqual(state.alternates, []);
  assert.equal(state.onIntranet, true);
});

test("域名页面上用后端排在最前的地址，其余进备用", () => {
  const state = adminEntryState({
    hosts: ["http://192.168.1.10:8080/", "http://10.0.0.7:8080", "http://192.168.1.10:8080"],
    pageOrigin: "https://cpswang.xknot.si",
  });
  assert.equal(state.primary, "http://192.168.1.10:8080");
  assert.deepEqual(state.alternates, ["http://10.0.0.7:8080"]);
  assert.equal(state.onIntranet, false);
});

test("坏地址直接丢掉，不产生空链接", () => {
  const state = adminEntryState({ hosts: ["", "not a url", "/admin", null, "ftp://10.0.0.1"], pageOrigin: "" });
  assert.deepEqual(state.urls, []);
  assert.equal(state.primary, "");
  // 没有地址时也不说自己在内网：否则界面会主推一个点不开的「进入」。
  assert.equal(state.onIntranet, false);
});

test("票据拼在 # 后面，且编码", () => {
  assert.equal(adminUrl("http://127.0.0.1:8081", "t1.1.a.b"), "http://127.0.0.1:8081/admin/#t=t1.1.a.b");
  assert.equal(adminUrl("http://127.0.0.1:8081/", "a b"), "http://127.0.0.1:8081/admin/#t=a%20b");
  assert.equal(adminUrl("http://127.0.0.1:8081", ""), "http://127.0.0.1:8081/admin/");
  assert.equal(adminUrl("", "x"), "");
});

test("IPv6 压缩写法也要认出来", () => {
  // fc00::/7 与 fe80::/10 常被压缩成两三个字符（fd::1、fc::1），
  // 直接 parseInt 会算成 0xfd/0xfc，与掩码相与为 0。
  for (const host of ["fd::1", "fc::1", "fc0::1", "[fd12:3456::1]"]) {
    assert.equal(isIntranetHost(host), true, host);
  }
  for (const host of ["ab::1", "ff02::1", "fe00::1", "::ffff:192.168.1.1"]) {
    assert.equal(isIntranetHost(host), false, host);
  }
});
