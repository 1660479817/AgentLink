import assert from "node:assert/strict";
import test from "node:test";
import { MEDIA_PRIVATE, MEDIA_PUBLIC, directMediaReadable, mediaAudience } from "./preview.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const WISH_USER = "44444444-4444-4444-8444-444444444444";

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

// 可见范围要分「公开」「仅当事人」两档：缓存头按它决定能不能进共享缓存。
test("an anonymous viewer reads public media and nothing else", async () => {
  const publicDb = pool([{ user_id: OWNER, kind: "post", is_public: true, verdict: "passed", wish_user_id: null }]);
  assert.equal(await mediaAudience(publicDb, ID, null), MEDIA_PUBLIC);

  const privateDb = pool([{ user_id: OWNER, kind: "post", is_public: false, verdict: "passed", wish_user_id: null }]);
  assert.equal(await mediaAudience(privateDb, ID, null), null);
});

test("party-only media is classified private, not public", async () => {
  const ownPost = pool([{ user_id: OWNER, kind: "post", is_public: false, verdict: "pending", wish_user_id: null }]);
  assert.equal(await mediaAudience(ownPost, ID, OWNER), MEDIA_PRIVATE);

  const reply = pool([{ user_id: OWNER, kind: "wishRespond", is_public: false, verdict: "passed", wish_user_id: WISH_USER }]);
  assert.equal(await mediaAudience(reply, ID, WISH_USER), MEDIA_PRIVATE);
  assert.equal(await mediaAudience(reply, ID, OTHER), null);
});

test("a public row wins over the viewer being the author", async () => {
  const db = pool([
    { user_id: OWNER, kind: "post", is_public: false, verdict: "passed", wish_user_id: null },
    { user_id: OWNER, kind: "post", is_public: true, verdict: "passed", wish_user_id: null },
  ]);
  assert.equal(await mediaAudience(db, ID, OWNER), MEDIA_PUBLIC);
});
