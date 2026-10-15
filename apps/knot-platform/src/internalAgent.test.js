import assert from "node:assert/strict";
import test from "node:test";
import { internalAgentEmail, internalAgentName } from "./internalAgent.js";

test("an internal agent name is a short slug", () => {
  assert.equal(internalAgentName("bravesearch"), "bravesearch");
  assert.equal(internalAgentName(" BraveSearch "), null);
  assert.equal(internalAgentName(""), null);
  assert.equal(internalAgentName("a".repeat(41)), null);
});

test("internal agents share the admin mailbox", () => {
  const previous = process.env.KNOT_ADMIN_EMAIL;
  delete process.env.KNOT_ADMIN_EMAIL;
  try {
    assert.equal(internalAgentEmail(), "manwjh@gmail.com");
  } finally {
    if (previous == null) delete process.env.KNOT_ADMIN_EMAIL;
    else process.env.KNOT_ADMIN_EMAIL = previous;
  }
});
