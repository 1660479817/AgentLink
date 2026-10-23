import assert from "node:assert/strict";
import test from "node:test";

import { AGENT_TYPE_MAX, AGENT_TYPES, agentTypeSlug, agentTypeText, GENERIC_AGENT_TYPE } from "./agentTypes.js";

test("同名、别名、大小写都归一到同一个 slug", () => {
  assert.equal(agentTypeSlug("doubao"), "doubao");
  assert.equal(agentTypeSlug("Doubao"), "doubao");
  assert.equal(agentTypeSlug("豆包"), "doubao");
  assert.equal(agentTypeSlug("work buddy"), "workbuddy");
  assert.equal(agentTypeSlug("Work Buddy"), "workbuddy");
  assert.equal(agentTypeSlug("OpenClaw 01"), "openclaw");
  assert.equal(agentTypeSlug("moonshot"), "kimi");
  assert.equal(agentTypeSlug("通义"), "qwen");
});

test("认不出的名字不带标签，交给调用方退到通用图", () => {
  assert.equal(agentTypeSlug(""), "");
  assert.equal(agentTypeSlug(null), "");
  assert.equal(agentTypeSlug("cursor"), "");
  // 通用图本身不在名单里：它是「哪个都没认出」的那一张。
  assert.equal(agentTypeSlug(GENERIC_AGENT_TYPE), "");
});

test("写入归一：认得出存 slug，认不出存小写原文", () => {
  assert.equal(agentTypeText("豆包"), "doubao");
  assert.equal(agentTypeText("  Manus "), "manus");
  // 名单外的产品不丢：平台要看「还有哪些没进名单」，所以原样留下。
  assert.equal(agentTypeText("  Cursor  "), "cursor");
  assert.equal(agentTypeText("my  own   agent"), "my own agent");
});

test("清空用 null，不是空串", () => {
  assert.equal(agentTypeText(null), null);
  assert.equal(agentTypeText(undefined), null);
  assert.equal(agentTypeText(""), null);
  assert.equal(agentTypeText("   "), null);
});

test("只挡「不是字符串」和「太长」，长度与库里一致", () => {
  assert.throws(() => agentTypeText(42), /bad_agent_type/);
  assert.throws(() => agentTypeText(["doubao"]), /bad_agent_type/);
  assert.equal(agentTypeText("x".repeat(AGENT_TYPE_MAX)).length, AGENT_TYPE_MAX);
  assert.throws(() => agentTypeText("x".repeat(AGENT_TYPE_MAX + 1)), /bad_agent_type/);
  // 按字符算，不按字节：一个汉字算一个。
  assert.equal(agentTypeText("我".repeat(AGENT_TYPE_MAX)), "我".repeat(AGENT_TYPE_MAX));
  assert.throws(() => agentTypeText("我".repeat(AGENT_TYPE_MAX + 1)), /bad_agent_type/);
});

test("名单里没有重复的 slug", () => {
  const slugs = AGENT_TYPES.map((item) => item.slug);
  assert.deepEqual(slugs, [...new Set(slugs)]);
});
