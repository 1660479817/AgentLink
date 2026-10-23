import test from "node:test";
import assert from "node:assert/strict";
import { agentHeaders, identityConfig, parseIdentityText, pickByVu, webHeaders, xffForVu } from "./identity.js";

test("parseIdentityText 去掉空行、注释，并支持换行和逗号", () => {
  assert.deepEqual(parseIdentityText(" a \n\n# nope\nb,c\n"), ["a", "b", "c"]);
  assert.deepEqual(parseIdentityText(""), []);
});

test("pickByVu 按 VU 序号循环取身份，VU 从 1 开始", () => {
  const list = ["a", "b"];
  assert.equal(pickByVu(list, 1), "a");
  assert.equal(pickByVu(list, 2), "b");
  assert.equal(pickByVu(list, 3), "a");
  assert.equal(pickByVu([], 1), "");
});

test("xffForVu 每个 VU 一个不同地址，且落在基准测试保留段", () => {
  assert.equal(xffForVu(1), "198.18.0.1");
  assert.equal(xffForVu(250), "198.18.0.250");
  assert.equal(xffForVu(251), "198.18.1.1");
  assert.notEqual(xffForVu(1), xffForVu(2));
});

test("有 Cookie 时优先用 Cookie，不再带 XFF", () => {
  const config = identityConfig({ BENCH_COOKIES: "knot_sid=one\nknot_sid=two", BENCH_IDENTITY: "xff" });
  assert.equal(webHeaders(config, 1).Cookie, "knot_sid=one");
  assert.equal(webHeaders(config, 2).Cookie, "knot_sid=two");
  assert.equal(webHeaders(config, 1)["X-Forwarded-For"], undefined);
});

test("没有 Cookie 时 xff 模式按 VU 给地址；shared 模式不带身份头", () => {
  assert.equal(webHeaders(identityConfig({ BENCH_IDENTITY: "xff" }), 3)["X-Forwarded-For"], xffForVu(3));
  assert.deepEqual(webHeaders(identityConfig({}), 3), {});
});

test("Agent 授权码按 VU 取，缺省回退到单份授权码", () => {
  const config = identityConfig({ KNOT_AGENT_TOKENS: "t1\nt2" });
  assert.deepEqual(agentHeaders(config, 1), { Authorization: "Bearer t1" });
  assert.deepEqual(agentHeaders(config, 3), { Authorization: "Bearer t1" });
  assert.deepEqual(agentHeaders(identityConfig({}), 1, "fallback"), { Authorization: "Bearer fallback" });
});
