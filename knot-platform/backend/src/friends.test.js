import assert from "node:assert/strict";
import test from "node:test";
import { addFriend, directMentions, mentionList, removeFriend } from "./friends.js";

const AUTHOR = "11111111-1111-4111-8111-111111111111";
const FRIEND = "22222222-2222-4222-8222-222222222222";
const INTEL = "33333333-3333-4333-8333-333333333333";

test("mentions are friend ids, at most eight, without duplicates", () => {
  assert.deepEqual(mentionList(null), []);
  assert.deepEqual(mentionList([FRIEND, FRIEND]), [FRIEND]);
  assert.throws(() => mentionList("nope"), (error) => error.code === "bad_mention");
  assert.throws(() => mentionList(["x"]), (error) => error.code === "bad_mention");
  assert.throws(
    () => mentionList(Array.from({ length: 9 }, (_, index) => `00000000-0000-4000-8000-00000000000${index}`)),
    (error) => error.code === "bad_mention"
  );
});

test("adding a friend clears a dismissal and removing an internal agent records one", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("SELECT id, side")) return { rows: [{ id: FRIEND, side: "internal" }] };
      return { rows: [] };
    },
  };
  assert.deepEqual(await addFriend(pool, AUTHOR, FRIEND), { friend: true });
  assert.match(calls[1].sql, /DELETE FROM friend_dismissals/);
  assert.match(calls[2].sql, /INSERT INTO friendships/);
  calls.length = 0;
  assert.deepEqual(await removeFriend(pool, AUTHOR, FRIEND), { friend: false });
  assert.match(calls[1].sql, /DELETE FROM friendships/);
  assert.match(calls[2].sql, /INSERT INTO friend_dismissals/);
});

test("a person cannot friend themselves", async () => {
  const pool = {
    async query() {
      return { rows: [{ id: AUTHOR, side: "external" }] };
    },
  };
  await assert.rejects(addFriend(pool, AUTHOR, AUTHOR), (error) => error.code === "bad_state");
});

test("a mention notifies a friend once and leaves the message text", async () => {
  const notes = [];
  const mentioned = new Set();
  const pool = {
    async query(sql, params) {
      if (sql.includes("SELECT u.id")) return { rows: [{ id: FRIEND }] };
      if (sql.includes("INSERT INTO intel_mentions")) {
        const key = `${params[0]}:${params[1]}`;
        if (mentioned.has(key)) return { rows: [] };
        mentioned.add(key);
        return { rows: [{ user_id: params[1] }] };
      }
      if (sql.includes("INSERT INTO notifications")) {
        notes.push(params);
        return { rows: [{ id: "n1" }] };
      }
      return { rows: [] };
    },
  };
  const input = { authorId: AUTHOR, intelId: INTEL, kind: "post", body: "看一下", mentions: [FRIEND] };
  await directMentions(pool, input);
  await directMentions(pool, input);
  assert.equal(notes.length, 1);
  assert.equal(notes[0][1], "mention");
  assert.equal(notes[0][2], "有人@了你");
  assert.equal(notes[0][3], "看一下");
  assert.equal(notes[0][4], "/discover");
  assert.equal(notes[0][5], INTEL);
  await directMentions(pool, {
    ...input,
    intelId: "44444444-4444-4444-8444-444444444444",
    kind: "wish",
    body: "",
  });
  assert.equal(notes[1][3], "一条信息");
  assert.equal(notes[1][4], "/wish");
  await assert.rejects(
    directMentions(pool, { ...input, kind: "wishRespond" }),
    (error) => error.code === "bad_mention"
  );
});
