import assert from "node:assert/strict";
import test from "node:test";
import { cardFiles, cardPreviewUrl, hasInformation, informationOf, isAttachmentUpload, isAudioUpload, isVideoUpload, knownPoster, listedFiles, previewImage, publicOf, videosOf } from "./information.js";

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

test("video links are http or https, and only the first one is kept", () => {
  assert.deepEqual(videosOf(["https://example.com/a", { url: "http://example.com/b" }]), ["https://example.com/a"]);
  assert.equal(videosOf(["https://example.com/1", "https://example.com/2", "https://example.com/3"]).length, 1);
  assert.throws(() => videosOf(["ftp://example.com/a"]), /bad_video/);
  assert.throws(() => videosOf("https://example.com/a"), /bad_video/);
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

test("a locked file keeps its name and drops the upload id", () => {
  const [locked] = listedFiles(
    [{ id: "secret", name: "a.png", mime: "image/png", url: "/api/web/uploads/secret", image: true }],
    false
  );
  assert.equal(locked.id, undefined);
  assert.equal(locked.url, undefined);
  assert.equal(locked.name, "a.png");
  assert.equal(listedFiles([{ id: "secret", url: "/api/web/uploads/secret", name: "a.png" }], true)[0].url, "/api/web/uploads/secret");
});

test("a card keeps a preview address and drops the original image address", () => {
  const files = [{ id: "secret", name: "a.png", mime: "image/png", url: "/api/web/uploads/secret", image: true }];
  const [shown] = cardFiles(files, true);
  assert.equal(shown.url, undefined);
  assert.equal(shown.id, undefined);
  assert.equal(shown.name, "a.png");
  assert.equal(cardPreviewUrl("11111111-1111-1111-1111-111111111111", files), "/api/web/previews/11111111-1111-1111-1111-111111111111");
  assert.equal(cardPreviewUrl("11111111-1111-1111-1111-111111111111", []), "");
});

test("an attachment is pdf, word, excel, ppt, or markdown", () => {
  assert.equal(isAttachmentUpload({ originalname: "报价.PDF" }), true);
  assert.equal(isAttachmentUpload({ originalname: "note.docx" }), true);
  assert.equal(isAttachmentUpload({ originalname: "sheet.xlsx" }), true);
  assert.equal(isAttachmentUpload({ originalname: "deck.pptx" }), true);
  assert.equal(isAttachmentUpload({ originalname: "readme.md" }), true);
  assert.equal(isAttachmentUpload({ originalname: "readme.markdown" }), true);
  assert.equal(isAttachmentUpload({ mimetype: "application/pdf", originalname: "notes.exe" }), false);
  assert.equal(isAttachmentUpload({ originalname: "old.doc" }), false);
  assert.equal(isAttachmentUpload({ originalname: "clip.mp4" }), false);
});

test("a video file is not an attachment", () => {
  assert.equal(isVideoUpload({ mimetype: "video/mp4", originalname: "clip.mp4" }), true);
  assert.equal(isVideoUpload({ mimetype: "application/octet-stream", originalname: "clip.mov" }), true);
  assert.equal(isVideoUpload({ mimetype: "application/pdf", originalname: "notes.pdf" }), false);
});
