import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackHost, isPrivateIPv4, isVirtualIface, listAdminHosts } from "./adminHosts.js";

const interfaces = {
  lo0: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  en0: [
    { address: "fe80::1", family: "IPv6", internal: false },
    { address: "192.168.1.10", family: "IPv4", internal: false },
  ],
  en1: [{ address: "10.0.0.7", family: 4, internal: false }],
  utun: [{ address: "172.20.1.2", family: "IPv4", internal: false }],
};

test("私有网段与回环", () => {
  for (const address of ["10.1.2.3", "172.16.0.1", "172.31.255.1", "192.168.1.10", "169.254.1.1"]) {
    assert.equal(isPrivateIPv4(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "11.0.0.1", "192.169.1.1", "not-an-ip"]) {
    assert.equal(isPrivateIPv4(address), false, address);
  }
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("127.1.2.3"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1:8081"), false);
  assert.equal(isLoopbackHost("192.168.1.10"), false);
});

test("绑定回环：只给本机地址", () => {
  assert.deepEqual(listAdminHosts({ bindHost: "127.0.0.1", port: 8081, interfaces }), ["http://127.0.0.1:8081"]);
  // 只绑了 ::1 的实例，127.0.0.1 上没有监听，链接得带上方括号。
  assert.deepEqual(listAdminHosts({ bindHost: "::1", port: 8081, interfaces }), ["http://[::1]:8081"]);
});

test("绑定一个具体内网地址：就用它", () => {
  assert.deepEqual(listAdminHosts({ bindHost: "192.168.1.10", port: 8080, interfaces }), ["http://192.168.1.10:8080"]);
});

test("绑定通配地址：枚举私有 IPv4，常见网段在前", () => {
  assert.deepEqual(listAdminHosts({ bindHost: "0.0.0.0", port: 8080, interfaces }), [
    "http://192.168.1.10:8080",
    "http://10.0.0.7:8080",
    "http://172.20.1.2:8080",
  ]);
});

test("没有可用网卡时回落到回环，链接不至于为空", () => {
  assert.deepEqual(listAdminHosts({ bindHost: "0.0.0.0", port: 8080, interfaces: {} }), ["http://127.0.0.1:8080"]);
});

test("KNOT_ADMIN_ORIGIN 覆盖推断，并去掉尾斜杠", () => {
  assert.deepEqual(
    listAdminHosts({ bindHost: "0.0.0.0", port: 8080, interfaces, env: { KNOT_ADMIN_ORIGIN: "http://knot.lan:9000/" } }),
    ["http://knot.lan:9000"]
  );
});

test("出口域名是 IP 时不会把它当成内网管理地址", () => {
  assert.deepEqual(
    listAdminHosts({
      bindHost: "0.0.0.0",
      port: 8080,
      publicOrigin: "http://192.168.1.10:8080",
      interfaces,
      env: {},
    }),
    ["http://10.0.0.7:8080", "http://172.20.1.2:8080"]
  );
});

test("虚拟网卡名识别：docker0 / br- / veth 等", () => {
  assert.equal(isVirtualIface("docker0"), true);
  assert.equal(isVirtualIface("br-abc123"), true);
  assert.equal(isVirtualIface("veth0abc"), true);
  assert.equal(isVirtualIface("eno1"), false);
  assert.equal(isVirtualIface("enp2s0"), false);
});

test("跳过 docker0，避免管理链接落到 172.17.0.1", () => {
  const withDocker = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eno1: [{ address: "192.168.3.22", family: "IPv4", internal: false }],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  };
  assert.deepEqual(listAdminHosts({ bindHost: "0.0.0.0", port: 8080, interfaces: withDocker, env: {} }), [
    "http://192.168.3.22:8080",
  ]);
});

test("出口就是唯一局域网地址时仍用它（不被 docker 网桥顶替）", () => {
  const withDocker = {
    lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    eno1: [{ address: "192.168.3.22", family: "IPv4", internal: false }],
    docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
  };
  assert.deepEqual(
    listAdminHosts({
      bindHost: "0.0.0.0",
      port: 8080,
      publicOrigin: "http://192.168.3.22:8080",
      interfaces: withDocker,
      env: {},
    }),
    ["http://192.168.3.22:8080"]
  );
});
