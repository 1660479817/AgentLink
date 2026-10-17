import assert from "node:assert/strict";
import test from "node:test";
import { fileView, hasInformation, informationOf, isArchiveUpload, isAttachmentUpload, isAudioUpload, isVideoUpload, knownPoster, listedFiles, previewImage, previewVideo, publicOf, uploadName, videoItemsOf } from "./information.js";

test("a latin1 upload name is shown as chinese", () => {
  const garbled = Buffer.from("今日简史.pdf", "utf8").toString("latin1");
  assert.equal(uploadName(garbled), "今日简史.pdf");
  assert.equal(uploadName("今日简史.pdf"), "今日简史.pdf");
  assert.equal(uploadName("notes.pdf"), "notes.pdf");
  assert.equal(fileView({ id: "1", mime: "application/pdf", original_name: garbled }).name, "今日简史.pdf");
  assert.equal(fileView({ id: "1", mime: "image/jpeg", original_name: "a.jpg" }).url, "/api/web/uploads/1/display");
  assert.equal(fileView({ id: "1", mime: "audio/mpeg", original_name: "a.mp3" }).url, "/api/web/uploads/1");
});

test("a packet splits text, images, video links, and files", () => {
  const info = informationOf({
    body: " 文字 ",
    videos: ["https://example.com/watch"],
    files: [
      { id: "img", url: "/api/web/uploads/img", name: "a.png", mime: "image/png", image: true },
      { id: "sound", url: "/api/web/uploads/sound", name: "a.mp3", mime: "audio/mpeg", audio: true },
      { id: "file", url: "/api/web/uploads/file", name: "a.pdf", mime: "application/pdf", image: false },
    ],
  });
  assert.equal(info.body, "文字");
  assert.equal(info.images.length, 1);
  assert.equal(info.audio.length, 1);
  assert.deepEqual(info.videos, [{ url: "https://example.com/watch" }]);
  assert.equal(info.attachments.length, 1);
  assert.equal(hasInformation({ body: "", images: [], videos: info.videos, attachments: [] }), true);
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

test("a video link can carry a preview image", () => {
  assert.equal(knownPoster("https://www.youtube.com/watch?v=abc123"), "https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  assert.equal(knownPoster("https://example.com/watch"), "");
  const html = `<meta property="og:image" content="https://cdn.example.com/cover.jpg">`;
  assert.equal(previewImage(html, "https://example.com/watch"), "https://cdn.example.com/cover.jpg");
  assert.equal(
    informationOf({ videos: [{ url: "https://example.com/watch", poster: "https://cdn.example.com/cover.jpg" }] }).videos[0].poster,
    "https://cdn.example.com/cover.jpg"
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

test("a locked attachment keeps its name and drops the address", () => {
  const [locked] = listedFiles(
    [{ id: "secret", name: "a.pdf", mime: "application/pdf", url: "/api/web/uploads/secret" }],
    false
  );
  assert.equal(locked.id, undefined);
  assert.equal(locked.url, undefined);
  assert.equal(locked.name, "a.pdf");
  assert.equal(listedFiles([{ id: "secret", url: "/api/web/uploads/secret", name: "a.pdf" }], true)[0].url, "/api/web/uploads/secret");
});

test("a card keeps the original image address", () => {
  const files = [{ id: "secret", name: "a.png", mime: "image/png", url: "/api/web/uploads/secret", image: true }];
  const [shown] = listedFiles(files, false);
  assert.equal(shown.url, "/api/web/uploads/secret");
  assert.equal(shown.name, "a.png");
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
