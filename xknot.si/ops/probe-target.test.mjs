import assert from "node:assert/strict";
import test from "node:test";

import { PROBE_PATH, healthUrlOf, probeEnabled, probeTargetOf } from "./probe-target.mjs";

test("the probe url is url + /api/health", () => {
  assert.equal(PROBE_PATH, "/api/health");
  assert.equal(healthUrlOf({ url: "https://wang.xknot.si" }), "https://wang.xknot.si/api/health");
  assert.equal(healthUrlOf({ url: "https://wang.xknot.si/" }), "https://wang.xknot.si/api/health");
  // 自有域名模式的 url 就是伙伴自己的地址，探测路径相同。
  assert.equal(healthUrlOf({ url: "https://nordhavn.example" }), "https://nordhavn.example/api/health");
});

test("a path in url does not leak into the probe url", () => {
  // 清单里 url 理论上只写站点根；写歪了也不能探到子页上。
  assert.equal(healthUrlOf({ url: "https://zjj.xknot.si/portal/" }), "https://zjj.xknot.si/api/health");
  assert.equal(healthUrlOf({ url: "https://example.com/shop/" }), "https://example.com/api/health");
});

test("only a https url can be probed", () => {
  assert.equal(healthUrlOf({ url: "http://wang.xknot.si" }), null);
  assert.equal(healthUrlOf({ url: "https://user:pass@wang.xknot.si" }), null);
  assert.equal(healthUrlOf({ url: "" }), null);
  assert.equal(healthUrlOf({ url: "not a url" }), null);
  assert.equal(healthUrlOf(null), null);
});

test("status decides whether the entry is probed", () => {
  assert.equal(probeEnabled({ status: "active" }), true);
  // pending 是已收录、未验收：不探，走「从未接通」的计时。
  assert.equal(probeEnabled({ status: "pending" }), false);
  assert.equal(probeEnabled({ status: "suspended" }), false);
  assert.equal(probeEnabled({ status: "retired" }), false);
  assert.equal(probeEnabled({}), false);
  assert.equal(probeEnabled(null), false);
});

test("probeTargetOf combines the two rules", () => {
  assert.deepEqual(probeTargetOf({ id: "wang", url: "https://wang.xknot.si", status: "active" }), {
    enabled: true,
    url: "https://wang.xknot.si/api/health",
  });
  assert.deepEqual(probeTargetOf({ id: "wang", url: "https://wang.xknot.si", status: "pending" }), {
    enabled: false,
    url: "https://wang.xknot.si/api/health",
  });
  // 地址都推不出来时，什么状态都探不了。
  assert.deepEqual(probeTargetOf({ id: "x", status: "active" }), { enabled: false, url: null });
});
