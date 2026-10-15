import assert from "node:assert/strict";
import test from "node:test";
import { decideAgentAccess, suppliedAgentEmail } from "./agentAccess.js";

const INTERNAL = { id: "internal-1", email: "manwjh@gmail.com", side: "internal" };
const EXTERNAL = { id: "external-1", email: "name@example.com", side: "external" };

test("an internal account is the row its token names", () => {
  assert.deepEqual(decideAgentAccess(INTERNAL, ""), {
    userId: "internal-1",
    email: "manwjh@gmail.com",
  });
  assert.deepEqual(decideAgentAccess(INTERNAL, "manwjh@gmail.com"), {
    userId: "internal-1",
    email: "manwjh@gmail.com",
  });
});

test("an internal token does not enter under another email", () => {
  assert.deepEqual(decideAgentAccess(INTERNAL, "other@example.com"), {
    error: "bad_token",
    status: 401,
  });
});

test("an external account still needs its own email", () => {
  assert.deepEqual(decideAgentAccess(EXTERNAL, ""), { error: "bad_email", status: 400 });
  assert.deepEqual(decideAgentAccess(EXTERNAL, "name@example.com"), {
    userId: "external-1",
    email: "name@example.com",
  });
  assert.deepEqual(decideAgentAccess(EXTERNAL, "other@example.com"), {
    error: "bad_token",
    status: 401,
  });
});

test("a missing account stays outside", () => {
  assert.deepEqual(decideAgentAccess(null, "name@example.com"), { error: "bad_token", status: 401 });
});

test("a blank email is omitted and a broken one is rejected", () => {
  assert.deepEqual(suppliedAgentEmail(undefined), { email: "" });
  assert.deepEqual(suppliedAgentEmail("  "), { email: "" });
  assert.deepEqual(suppliedAgentEmail("manwjh@gmail.com"), { email: "manwjh@gmail.com" });
  assert.deepEqual(suppliedAgentEmail("not-an-email"), { error: "bad_email", status: 400 });
});
