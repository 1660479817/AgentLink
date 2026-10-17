import assert from "node:assert/strict";
import test from "node:test";
import { adminEmail, defaultDisplayName, feedbackMessage, loginKeyMessage, newLoginKey, normalizeLoginKey } from "./login.js";

test("login key is six digits", () => {
  for (let i = 0; i < 30; i += 1) {
    const key = newLoginKey();
    assert.match(key, /^\d{6}$/);
    assert.equal(normalizeLoginKey(key), key);
  }
  assert.equal(normalizeLoginKey(" 048 291 "), "048291");
  assert.equal(normalizeLoginKey("4829131"), null);
  assert.equal(normalizeLoginKey("AB23CD45"), null);
});

test("a default display name is the email prefix, never empty", () => {
  assert.equal(defaultDisplayName("paul.wang@example.com"), "paul.wang");
  assert.equal(defaultDisplayName("PAUL@example.com"), "PAUL");
  assert.equal(defaultDisplayName(""), "用户");
  assert.equal(defaultDisplayName("a".repeat(60) + "@example.com"), "a".repeat(40));
});

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

test("the login key email carries the key as HTML and plain text", () => {
  const message = loginKeyMessage("048291");
  assert.equal(message.subject, "Knot 登录密钥");
  assert.match(message.text, /048291/);
  assert.match(message.text, /十分钟内有效/);
  assert.match(message.html, /登录和注册都用这一把密钥/);
  for (const digit of "048291") {
    assert.match(message.html, new RegExp(`>${digit}</div>`));
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
