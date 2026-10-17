import assert from "node:assert/strict";
import test from "node:test";
import { toRecord } from "./card.js";
import { contentHash, readImageMedia, readMedia } from "./links.js";

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
  assert.deepEqual(readMedia([`/api/web/uploads/${ID}/display`], 4).ids, [ID]);
});

test("images only accept an uploaded id, not an external url", () => {
  assert.deepEqual(
    readImageMedia([ID, { id: "22222222-2222-4222-8222-222222222222" }], 4),
    [ID, "22222222-2222-4222-8222-222222222222"]
  );
  assert.deepEqual(readImageMedia([`/api/web/uploads/${ID}/display`], 4), [ID]);
  assert.throws(() => readImageMedia([{ url: "https://example.com/a.jpg" }], 4), (e) => e.code === "bad_image");
  assert.throws(() => readImageMedia(["https://example.com/a.jpg"], 4), (e) => e.code === "bad_image");
});

test("the same content keeps one hash", () => {
  const video = { url: "https://example.com/v", poster: { url: "https://cdn.example.com/c.jpg" } };
  const first = contentHash({
    kind: "post",
    body: "原文",
    imageIds: [ID],
    videos: [video],
  });
  const again = contentHash({
    kind: "post",
    body: "原文",
    imageIds: [ID.toUpperCase()],
    videos: [video],
  });
  assert.equal(first, again);
  assert.equal(first.length, 64);
  assert.notEqual(first, contentHash({ kind: "wish", body: "原文", imageIds: [ID] }));
  assert.notEqual(first, contentHash({ kind: "post", body: "原文", respondsTo: null, imageIds: [ID], videos: [{ url: "https://example.com/other", poster: video.poster }] }));
  assert.notEqual(first, contentHash({ kind: "post", body: "原文", imageIds: [ID], videos: [{ url: video.url, poster: { url: "https://cdn.example.com/other.jpg" } }] }));
});

test("a card shows a stored image", () => {
  const record = toRecord(
    {
      id: "a1",
      kind: "post",
      body: "原文",
      price: 10,
      is_public: true,
      verdict: "passed",
      content_hash: "abc",
      videos: [{ url: "https://example.com/v" }],
      created_at: "2026-10-13T00:00:00.000Z",
    },
    {
      files: [{ id: ID, name: "a.jpg", mime: "image/jpeg", url: `/api/web/uploads/${ID}`, image: true, size: 3 * 1024 * 1024 }],
      granted: false,
    }
  );
  assert.equal(record.kMeta.hash, "abc");
  assert.equal(record.kMeta.kind, "post");
  assert.equal(record.kMeta.version, 1);
  assert.deepEqual(record.kMeta.commerce, { price: 10, fee: 0, payee: "author" });
  assert.equal(record.images[0].url, `/api/web/uploads/${ID}`);
  assert.equal(record.images[0].stored, true);
  assert.equal(record.previewUrl, "");
  assert.equal(record.kMeta.note, "");
});

test("a card keeps the reviewer note and ignores a review error", () => {
  const record = toRecord({
    id: "a2",
    kind: "post",
    verdict: "passed",
    detail: { note: "  曾国藩传记  ", language: " zh ", reviewError: "agent_timeout" },
  });
  assert.equal(record.kMeta.note, "曾国藩传记");
  assert.equal(record.kMeta.language, "zh");
});

test("a card shows an attachment name and keeps the file address off it", () => {
  const record = toRecord(
    {
      id: "a2",
      kind: "post",
      body: "原文",
      price: 10,
      is_public: true,
      verdict: "passed",
      links: { attachments: [{ url: "https://example.com/a.pdf", name: "外链.pdf" }] },
    },
    {
      files: [{ id: ID, name: "书.pdf", mime: "application/pdf", url: `/api/web/uploads/${ID}` }],
      granted: true,
    }
  );
  assert.equal(record.attachments[0].name, "书.pdf");
  assert.equal(record.attachments[0].url, undefined);
  assert.equal(record.attachments[1].name, "外链.pdf");
  assert.equal(record.attachments[1].url, undefined);
  const audio = toRecord(
    { id: "a3", kind: "post", body: "", links: {} },
    { files: [{ name: "一段.mp3", mime: "audio/mpeg", url: "/api/web/uploads/audio", audio: true }], granted: true }
  );
  assert.equal(audio.audio[0].url, "/api/web/uploads/audio");
});

test("a card keeps who wrote it", () => {
  assert.equal(toRecord({ id: "p", actor: "person" }).actor, "person");
  assert.equal(toRecord({ id: "a", actor: "personal_agent" }).actor, "personal_agent");
  assert.equal(toRecord({ id: "f", actor: "platform" }).actor, "platform");
  assert.equal(toRecord({ id: "x" }).actor, undefined);
  assert.equal(toRecord({ id: "y", actor: "other" }).actor, undefined);
});

test("a wish pays the platform", () => {
  const record = toRecord({ id: "w1", kind: "wish", price: 1, is_public: false }, { granted: false });
  assert.equal(record.kMeta.commerce.payee, "platform");
  assert.equal(record.kMeta.public, false);
});

test("a card charges a download service fee from attachment bytes", () => {
  const record = toRecord(
    { id: "f1", kind: "post", price: 5, is_public: true },
    { files: [{ id: "x", name: "a.bin", mime: "application/octet-stream", size: 1024 * 1024 + 1 }] }
  );
  assert.equal(record.kMeta.commerce.fee, 2); // 1MB 出头 → 2 积分（向上取整）
  assert.equal(record.kMeta.commerce.price, 5);
});
