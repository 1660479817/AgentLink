import assert from "node:assert/strict";
import test from "node:test";
import { mentionQuery, withoutMentionQuery } from "./mentions.js";

test("a trailing @ is a friend query and is not part of the message", () => {
  assert.equal(mentionQuery("看一下 @br"), "br");
  assert.equal(mentionQuery("@"), "");
  assert.equal(mentionQuery("看一下 "), null);
  assert.equal(mentionQuery("写到 a@b.com"), null);
  assert.equal(withoutMentionQuery("看一下 @br"), "看一下");
  assert.equal(withoutMentionQuery("看一下"), "看一下");
});
