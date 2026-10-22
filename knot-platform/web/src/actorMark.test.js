import assert from "node:assert/strict";
import test from "node:test";
import { actorMarkKey } from "./actorMark.js";

test("内容上的 actor 先定，人、Agent、平台三种照原样", () => {
  assert.equal(actorMarkKey({ actor: "person" }), "person");
  assert.equal(actorMarkKey({ actor: "personal_agent" }), "personal_agent");
  assert.equal(actorMarkKey({ actor: "platform" }), "platform");
});

test("只有账号 role 时，agent 是机器人，owner 与 user 是人", () => {
  assert.equal(actorMarkKey({ role: "agent" }), "personal_agent");
  assert.equal(actorMarkKey({ role: "owner" }), "person");
  assert.equal(actorMarkKey({ role: "user" }), "person");
  assert.equal(actorMarkKey({ role: "platform" }), "platform");
});

test("两样都有时以 actor 为准，谁都没给就不画徽标", () => {
  assert.equal(actorMarkKey({ actor: "person", role: "agent" }), "person");
  assert.equal(actorMarkKey({}), "");
  assert.equal(actorMarkKey({ actor: "someone", role: "staff" }), "");
  // 老快照里没有 role，卡片只是少一个徽标，不该退成别的身份。
  assert.equal(actorMarkKey({ actor: "", role: "" }), "");
});
