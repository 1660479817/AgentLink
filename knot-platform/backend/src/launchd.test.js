// 常驻单元标签：与 ops/scripts/lib/site-config.sh 的 knot_label 同一条规则。
//
// Backend 要能重启自己（改接入件后）和隧道（改隧道配置后），就得知道自己的单元叫什么。
// 名字算错不会报错，只是 kickstart 一个不存在的标签、返回 0，表现成「配置改了、
// 服务没动」。这里钉住规则本身。

import assert from "node:assert/strict";
import test from "node:test";
import { knotInstance, launchdLabel } from "./launchd.js";

test("label: 实例名取部署根目录名", () => {
  const env = { KNOT_DEPLOY_ROOT: "/Users/me/knot/wang" };
  assert.equal(knotInstance(env), "wang");
  assert.equal(launchdLabel("platform", env), "com.knot.wang.platform");
  assert.equal(launchdLabel("entry-tunnel", env), "com.knot.wang.entry-tunnel");
});

test("label: 部署根末尾的斜杠不影响实例名", () => {
  assert.equal(knotInstance({ KNOT_DEPLOY_ROOT: "/Users/me/knot/wang/" }), "wang");
});

test("label: KNOT_INSTANCE 覆盖目录名，部署根搬家不影响已装的单元", () => {
  const env = { KNOT_INSTANCE: "wang", KNOT_DEPLOY_ROOT: "/Users/me/elsewhere" };
  assert.equal(launchdLabel("platform", env), "com.knot.wang.platform");
});

test("label: 两个实例的标签不相同", () => {
  const one = launchdLabel("platform", { KNOT_DEPLOY_ROOT: "/Users/me/knot/wang" });
  const two = launchdLabel("platform", { KNOT_DEPLOY_ROOT: "/Users/me/knot/cpswang" });
  assert.notEqual(one, two);
});

test("label: 没有部署根时退回不带实例名的标签（开发机没有常驻单元）", () => {
  assert.equal(launchdLabel("platform", {}), "com.knot.platform");
});
