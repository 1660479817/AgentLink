import assert from "node:assert/strict";
import { test } from "node:test";
import { cardShareUrl } from "./share.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("a card link opens the post in the discover feed", () => {
  assert.equal(cardShareUrl(ID, "https://knot.example.com"), `https://knot.example.com/discover?post=${ID}`);
});

test("a trailing slash on the origin is not doubled", () => {
  assert.equal(cardShareUrl(ID, "http://192.168.3.91:8080/"), `http://192.168.3.91:8080/discover?post=${ID}`);
});

test("an empty card id has no link", () => {
  assert.equal(cardShareUrl("", "https://knot.example.com"), "");
  assert.equal(cardShareUrl(null, "https://knot.example.com"), "");
});
