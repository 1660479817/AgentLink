import assert from "node:assert/strict";
import test from "node:test";
import { fileView, filesByIntel, hasInformation, imageSizeOf, isArchiveUpload, isAttachmentUpload, isAudioUpload, isVideoUpload, previewVideo, publicOf, uploadName, videoItemsOf } from "./information.js";

test("a latin1 upload name is shown as chinese", () => {
  const garbled = Buffer.from("今日简史.pdf", "utf8").toString("latin1");
  assert.equal(uploadName(garbled), "今日简史.pdf");
  assert.equal(uploadName("今日简史.pdf"), "今日简史.pdf");
  assert.equal(uploadName("notes.pdf"), "notes.pdf");
  assert.equal(fileView({ id: "1", mime: "application/pdf", original_name: garbled }).name, "今日简史.pdf");
  assert.equal(fileView({ id: "1", mime: "image/jpeg", original_name: "a.jpg" }).url, "/api/web/uploads/1/display");
  assert.equal(fileView({ id: "1", mime: "audio/mpeg", original_name: "a.mp3" }).url, "/api/web/uploads/1");
  // 卡片按这两个数算多图排版；没有尺寸的上传不带这两个字段，前端退回 4:3。
  assert.deepEqual(imageSizeOf({ width: 1280, height: 720 }), { width: 1280, height: 720 });
  assert.equal(imageSizeOf({ width: null, height: null }), null);
  assert.deepEqual(
    fileView({ id: "1", mime: "image/jpeg", original_name: "a.jpg", width: 800, height: 600 }),
    { ...fileView({ id: "1", mime: "image/jpeg", original_name: "a.jpg" }), width: 800, height: 600 }
  );
  assert.equal(fileView({ id: "2", mime: "audio/mpeg", original_name: "a.mp3", width: 800, height: 600 }).width, undefined);
});

test("hasInformation counts any present part", () => {
  assert.equal(hasInformation({ body: "文字" }), true);
  assert.equal(hasInformation({ videos: [{ url: "https://example.com/watch" }] }), true);
  assert.equal(hasInformation({ body: "", images: [], audio: [], videos: [], attachments: [] }), false);
});

// 列表、快照、Agent 读路径共用这一份附件查询：一次往返，去重后按记录分组。
test("a batch of records fetches its files in one query", async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return {
        rows: [
          { intel_id: "a", id: "1", mime: "image/jpeg", original_name: "a.jpg", size: 10 },
          { intel_id: "b", id: "2", mime: "application/pdf", original_name: "b.pdf", size: 20 },
          { intel_id: "a", id: "3", mime: "audio/mpeg", original_name: "c.mp3", size: 30 },
        ],
      };
    },
  };
  const byId = await filesByIntel(pool, ["a", "b", "a", null]);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [["a", "b"]]);
  assert.deepEqual([...byId.keys()], ["a", "b"]);
  assert.deepEqual(byId.get("a").map((file) => file.id), ["1", "3"]);
  assert.equal(byId.get("b")[0].image, false);
});

test("an empty batch costs no query", async () => {
  let queried = false;
  const pool = {
    async query() {
      queried = true;
      return { rows: [] };
    },
  };
  const byId = await filesByIntel(pool, []);
  assert.equal(queried, false);
  assert.equal(byId.size, 0);
});

test("a video item carries a required poster as an upload id", () => {
  const ID = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(
    videoItemsOf([{ url: "https://example.com/a.mp4", poster: { id: ID.toUpperCase() } }]),
    [{ url: "https://example.com/a.mp4", poster: { id: ID } }]
  );
});

test("a video item needs an uploaded poster", () => {
  assert.throws(() => videoItemsOf([{ url: "https://example.com/a.mp4" }]), (e) => e.code === "bad_poster");
  assert.throws(() => videoItemsOf(["https://example.com/a.mp4"]), (e) => e.code === "bad_poster");
  assert.throws(() => videoItemsOf([{ url: "https://example.com/a.mp4", poster: { url: "https://cdn.example.com/a.jpg" } }]), (e) => e.code === "bad_poster");
  assert.throws(() => videoItemsOf([{ url: "https://example.com/a.mp4", poster: { id: "nope" } }]), (e) => e.code === "bad_poster");
  assert.throws(() => videoItemsOf([{ url: "ftp://x", poster: { id: "11111111-1111-4111-8111-111111111111" } }]), (e) => e.code === "bad_video");
  assert.throws(() => videoItemsOf("https://example.com/a.mp4"), (e) => e.code === "bad_video");
});

test("only the first video is kept", () => {
  const poster = { id: "11111111-1111-4111-8111-111111111111" };
  assert.equal(
    videoItemsOf([{ url: "https://example.com/1", poster }, { url: "https://example.com/2", poster }]).length,
    1
  );
});

test("a landing page resolves its playable video stream", () => {
  const base = "https://example.com/news/watch";
  assert.equal(
    previewVideo(`<meta property="og:video" content="/v/clip.mp4">`, base),
    "https://example.com/v/clip.mp4"
  );
  assert.equal(
    previewVideo(`<meta property="og:video:url" content="https://cdn.example.com/c.mp4">`, base),
    "https://cdn.example.com/c.mp4"
  );
  assert.equal(
    previewVideo(`<meta name="twitter:player:stream" content="https://cdn.example.com/s.mp4">`, base),
    "https://cdn.example.com/s.mp4"
  );
  assert.equal(
    previewVideo(`<video src="https://cdn.example.com/inline.webm"></video>`, base),
    "https://cdn.example.com/inline.webm"
  );
  assert.equal(previewVideo(`<meta property="og:video" content="ftp://bad">`, base), "");
  assert.equal(previewVideo(`<p>no stream here</p>`, base), "");
});

test("public defaults to on", () => {
  assert.equal(publicOf(undefined), true);
  assert.equal(publicOf("on"), true);
  assert.equal(publicOf("off"), false);
  assert.equal(publicOf(false), false);
  assert.throws(() => publicOf("maybe"), /bad_public/);
});

test("audio is its own file and not an attachment", () => {
  assert.equal(isAudioUpload({ mimetype: "audio/mpeg", originalname: "note.mp3" }), true);
  assert.equal(isAudioUpload({ mimetype: "application/octet-stream", originalname: "note.m4a" }), true);
  assert.equal(isAudioUpload({ mimetype: "application/pdf", originalname: "notes.pdf" }), false);
});

test("an attachment is pdf, word, excel, ppt, markdown, or an archive", () => {
  assert.equal(isAttachmentUpload({ originalname: "报价.PDF" }), true);
  assert.equal(isAttachmentUpload({ originalname: "note.docx" }), true);
  assert.equal(isAttachmentUpload({ originalname: "sheet.xlsx" }), true);
  assert.equal(isAttachmentUpload({ originalname: "deck.pptx" }), true);
  assert.equal(isAttachmentUpload({ originalname: "readme.md" }), true);
  assert.equal(isAttachmentUpload({ originalname: "readme.markdown" }), true);
  assert.equal(isAttachmentUpload({ originalname: "包.zip" }), true);
  assert.equal(isArchiveUpload({ originalname: "包.ZIP" }), true);
  assert.equal(isArchiveUpload({ originalname: "包.rar" }), true);
  assert.equal(isArchiveUpload({ originalname: "包.7z" }), true);
  assert.equal(isArchiveUpload({ originalname: "notes.pdf" }), false);
  assert.equal(isAttachmentUpload({ mimetype: "application/pdf", originalname: "notes.exe" }), false);
  assert.equal(isAttachmentUpload({ originalname: "old.doc" }), false);
  assert.equal(isAttachmentUpload({ originalname: "clip.mp4" }), false);
});

test("a video file is not an attachment", () => {
  assert.equal(isVideoUpload({ mimetype: "video/mp4", originalname: "clip.mp4" }), true);
  assert.equal(isVideoUpload({ mimetype: "application/octet-stream", originalname: "clip.mov" }), true);
  assert.equal(isVideoUpload({ mimetype: "application/pdf", originalname: "notes.pdf" }), false);
});
