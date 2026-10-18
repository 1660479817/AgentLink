import assert from "node:assert/strict";
import test from "node:test";
import { directMediaReadable } from "./preview.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function pool(rows) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

test("a video poster is readable when its post is public", async () => {
  const db = pool([{ user_id: OWNER, kind: "fastpost", is_public: true, verdict: "pending", wish_user_id: null }]);
  assert.equal(await directMediaReadable(db, ID, OTHER), true);
  assert.equal(db.calls[0].params[0], ID);
  assert.equal(db.calls[0].params[1], `/api/web/uploads/${ID}/display`);
});

test("a video poster stays closed when the post is private", async () => {
  const db = pool([{ user_id: OWNER, kind: "post", is_public: false, verdict: "passed", wish_user_id: null }]);
  assert.equal(await directMediaReadable(db, ID, OTHER), false);
});

test("the owner still reads their own poster", async () => {
  const db = pool([{ user_id: OWNER, kind: "post", is_public: false, verdict: "pending", wish_user_id: null }]);
  assert.equal(await directMediaReadable(db, ID, OWNER), true);
});

test("a rejected post no longer serves its poster", async () => {
  const db = pool([{ user_id: OWNER, kind: "fastpost", is_public: true, verdict: "rejected", wish_user_id: null }]);
  assert.equal(await directMediaReadable(db, ID, OTHER), false);
});

test("the poster lookup is case-insensitive", async () => {
  const db = pool([]);
  await directMediaReadable(db, ID.toUpperCase(), null);
  assert.equal(db.calls[0].params[1], `/api/web/uploads/${ID}/display`);
});
