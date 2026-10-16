import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { assembleDiscoverBoard, mediaPreviewUrl, presentDiscoverSelf, writeDiscoverBoard } from "./discoverBoard.js";
import { setDiscoverPublisher, touchDiscoverBoard } from "./discoverPublish.js";

const POST = "11111111-1111-4111-8111-111111111111";
const WISH = "22222222-2222-4222-8222-222222222222";
const AUTHOR = "33333333-3333-4333-8333-333333333333";
const FILE = "44444444-4444-4444-8444-444444444444";

function pool() {
  const post = {
    id: POST,
    body: "原文",
    videos: [],
    links: {},
    content_hash: "abc",
    detail: { note: "一句" },
    weight: 2,
    price: 8,
    category: "价格",
    kind: "post",
    responds_to: null,
    verdict: "passed",
    reject_reason: null,
    user_id: AUTHOR,
    is_public: true,
    created_at: "2026-10-15T00:00:00.000Z",
    updated_at: "2026-10-15T00:00:00.000Z",
    display_name: "甲",
    avatar_upload_id: null,
    starred: true,
    granted: true,
    friend: true,
    can_friend: true,
  };
  const wish = {
    id: WISH,
    body: "想要",
    videos: [],
    links: {},
    content_hash: "def",
    detail: {},
    price: 1,
    category: "",
    kind: "wish",
    is_public: false,
    user_id: AUTHOR,
    verdict: "pending",
    created_at: "2026-10-15T01:00:00.000Z",
    updated_at: "2026-10-15T01:00:00.000Z",
  };
  return {
    post,
    wish,
    async query(sql) {
      if (sql.includes("FROM intel_files")) {
        return { rows: [{ intel_id: POST, id: FILE, mime: "image/jpeg", original_name: "a.jpg" }, { intel_id: POST, id: "sound", mime: "audio/mpeg", original_name: "a.mp3" }] };
      }
      if (sql.includes("i.kind = 'wish'")) return { rows: [wish] };
      if (sql.includes("kind IN ('post', 'fastpost')")) return { rows: [post] };
      return { rows: [] };
    },
  };
}

test("the public board drops personal fields and keeps the wish author", async () => {
  const board = await assembleDiscoverBoard(pool());
  const card = board.information[0];
  assert.equal(card.personal, false);
  assert.equal(card.starred, false);
  assert.equal(card.friend, false);
  assert.equal(card.canFriend, false);
  assert.equal(card.granted, false);
  assert.equal(card.mine, false);
  assert.equal(card.author.name, "甲");
  assert.equal(card.previewUrl, `/api/web/previews/${POST}`);
  assert.equal(card.audio[0].url, undefined);
  assert.equal(board.requests[0].authorId, AUTHOR);
  assert.equal(board.requests[0].mine, false);
  assert.equal(board.requests[0].responseCount, null);
});

test("a personal patch lists dismissals, stars, friends, and unlocked audio", () => {
  const self = presentDiscoverSelf(
    [
      { id: POST, kind: "post", dismissed: true, starred: true, friend: false, granted: true, mine: false, links: {}, videos: [] },
      { id: WISH, kind: "wish", dismissed: false, starred: false, friend: true, granted: false, mine: true, response_count: 2, links: {}, videos: [] },
    ],
    new Map([[POST, [{ id: FILE, name: "a.mp3", mime: "audio/mpeg", url: "/api/web/uploads/sound", audio: true }]]])
  );
  assert.deepEqual(self.dismissed, [POST]);
  assert.deepEqual(self.starred, [POST]);
  assert.deepEqual(self.friends, [WISH]);
  assert.deepEqual(self.granted, [POST]);
  assert.deepEqual(self.mine, [WISH]);
  assert.equal(self.wishes[WISH].responseCount, 2);
  assert.equal(self.audio[POST][0].url, "/api/web/uploads/sound");
});

test("writing the board copies previews and drops stale ones", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "knot-board-"));
  const src = path.join(dir, "source.jpg");
  await writeFile(src, "jpeg");
  const previews = path.join(dir, "media", "previews");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(previews, { recursive: true });
  await writeFile(path.join(previews, "stale.jpg"), "old");
  try {
    const board = await writeDiscoverBoard(
      { pool: pool(), uploadDir: dir, boardDir: dir },
      { loadPreview: async () => src }
    );
    assert.equal(board.information[0].previewUrl, mediaPreviewUrl(POST));
    assert.equal(await readFile(path.join(previews, `${POST}.jpg`), "utf8"), "jpeg");
    await assert.rejects(readFile(path.join(previews, "stale.jpg")));
    const saved = JSON.parse(await readFile(path.join(dir, "discover.json"), "utf8"));
    assert.equal(saved.information[0].granted, false);
    assert.equal(saved.requests[0].authorId, AUTHOR);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a publisher is told when the board changes", () => {
  let calls = 0;
  setDiscoverPublisher(() => {
    calls += 1;
  });
  touchDiscoverBoard();
  touchDiscoverBoard();
  assert.equal(calls, 2);
  setDiscoverPublisher(null);
});
