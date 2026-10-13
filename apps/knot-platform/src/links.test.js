import assert from "node:assert/strict";
import test from "node:test";
import { toRecord } from "./card.js";
import { contentHash, readMedia } from "./links.js";

const ID = "11111111-1111-4111-8111-111111111111";

test("a media list accepts an upload id or an external url", () => {
  const media = readMedia([ID, { url: "https://example.com/a.jpg" }, { id: "22222222-2222-4222-8222-222222222222" }], 4);
  assert.deepEqual(media.ids, [ID, "22222222-2222-4222-8222-222222222222"]);
  assert.deepEqual(media.urls, ["https://example.com/a.jpg"]);
});

test("a platform upload url counts as a stored id", () => {
  const media = readMedia([`https://knot.example/api/web/uploads/${ID}`], 4);
  assert.deepEqual(media.ids, [ID]);
  assert.deepEqual(media.urls, []);
});

test("the same content keeps one hash", () => {
  const first = contentHash({
    kind: "post",
    body: "原文",
    imageIds: [ID],
    imageUrls: ["https://example.com/a.jpg"],
    videos: ["https://example.com/v"],
  });
  const again = contentHash({
    kind: "post",
    body: "原文",
    imageIds: [ID.toUpperCase()],
    imageUrls: ["https://example.com/a.jpg"],
    videos: ["https://example.com/v"],
  });
  assert.equal(first, again);
  assert.equal(first.length, 64);
  assert.notEqual(first, contentHash({ kind: "wish", body: "原文", imageIds: [ID] }));
  assert.notEqual(first, contentHash({ kind: "post", body: "原文", respondsTo: null, imageIds: [ID], videos: ["https://example.com/other"] }));
});

test("a card hides a stored original and keeps an external url", () => {
  const record = toRecord(
    {
      id: "a1",
      kind: "post",
      body: "原文",
      price: 10,
      is_public: true,
      verdict: "passed",
      content_hash: "abc",
      links: { images: [{ url: "https://example.com/a.jpg" }] },
      videos: [{ url: "https://example.com/v" }],
      created_at: "2026-10-13T00:00:00.000Z",
    },
    {
      files: [{ id: ID, name: "a.jpg", mime: "image/jpeg", url: `/api/web/uploads/${ID}`, image: true }],
      granted: false,
    }
  );
  assert.equal(record.kMeta.hash, "abc");
  assert.equal(record.kMeta.kind, "post");
  assert.equal(record.kMeta.version, 1);
  assert.deepEqual(record.kMeta.commerce, { price: 10, payee: "author" });
  assert.equal(record.images[0].url, undefined);
  assert.equal(record.images[0].stored, true);
  assert.equal(record.images[1].url, "https://example.com/a.jpg");
  assert.equal(record.images[1].stored, false);
  assert.equal(record.previewUrl, "/api/web/previews/a1");
});

test("a wish pays the platform", () => {
  const record = toRecord({ id: "w1", kind: "wish", price: 1, is_public: false }, { granted: false });
  assert.equal(record.kMeta.commerce.payee, "platform");
  assert.equal(record.kMeta.public, false);
});
