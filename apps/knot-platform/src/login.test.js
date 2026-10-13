import assert from "node:assert/strict";
import test from "node:test";
import { adminEmail, feedbackMessage } from "./login.js";

test("admin mailbox defaults to the platform address", () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  delete process.env.KNOT_ADMIN_EMAIL;
  try {
    assert.equal(adminEmail(), "manwjh@gmail.com");
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
});

test("a complaint letter names the account and keeps the text", () => {
  const message = feedbackMessage({
    kind: "complaint",
    accountEmail: "name@example.com",
    userId: "user-1",
    body: "页面打不开",
  });
  assert.equal(message.subject, "Knot 投诉");
  assert.match(message.text, /类型：投诉/);
  assert.match(message.text, /账户：name@example.com/);
  assert.match(message.text, /用户：user-1/);
  assert.match(message.text, /页面打不开/);
});
