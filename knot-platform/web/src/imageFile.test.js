import assert from "node:assert/strict";
import test from "node:test";
import { isHeicFile, looksLikeImage } from "./imageFile.js";

test("a picture is recognized by its mime type", () => {
  assert.equal(looksLikeImage({ type: "image/png", name: "a.png" }), true);
  assert.equal(looksLikeImage({ type: "image/jpeg", name: "a" }), true);
  // 没有扩展名的截图之类：只看类型就够。
  assert.equal(looksLikeImage({ type: "image/webp", name: "" }), true);
});

test("a file that is not a picture stays rejected on the client", () => {
  assert.equal(looksLikeImage({ type: "application/pdf", name: "a.pdf" }), false);
  assert.equal(looksLikeImage({ type: "text/plain", name: "notes.txt" }), false);
  assert.equal(looksLikeImage({ type: "video/mp4", name: "clip.mp4" }), false);
  assert.equal(looksLikeImage({ type: "", name: "notes.txt" }), false);
  assert.equal(looksLikeImage({ type: "", name: "" }), false);
  assert.equal(looksLikeImage(null), false);
  assert.equal(looksLikeImage(undefined), false);
});

test("an empty mime is still a picture when the name says heic", () => {
  // 少数相册不给出类型：这时靠文件名认，否则一张该转码的照片会被悄悄丢掉。
  assert.equal(looksLikeImage({ type: "", name: "IMG_0001.HEIC" }), true);
  assert.equal(looksLikeImage({ type: "", name: "IMG_0002.heif" }), true);
  assert.equal(looksLikeImage({ type: "", name: "IMG_0003.heic-sequence" }), true);
});

test("an empty mime falls back to known picture extensions, not to anything", () => {
  // 从应用里拷出来的照片有时没有类型，扩展名还是可信的。
  assert.equal(looksLikeImage({ type: "", name: "IMG_0004.jpg" }), true);
  assert.equal(looksLikeImage({ type: "", name: "screenshot.PNG" }), true);
  assert.equal(looksLikeImage({ type: "", name: "a.jpeg" }), true);
  assert.equal(looksLikeImage({ type: "", name: "a.webp" }), true);
  assert.equal(looksLikeImage({ type: "", name: "a.gif" }), true);
  // 认后缀不等于放行：非图片仍然挡在客户端，不靠服务端兜底。
  assert.equal(looksLikeImage({ type: "", name: "notes.md" }), false);
  assert.equal(looksLikeImage({ type: "", name: "a.pdf" }), false);
  assert.equal(looksLikeImage({ type: "", name: "a.jpg.exe" }), false);
});

test("heic detection follows the type when there is one", () => {
  assert.equal(isHeicFile({ type: "image/heic", name: "photo.jpg" }), true);
  assert.equal(isHeicFile({ type: "image/heif-sequence", name: "" }), true);
  // 有类型就信类型：改过扩展名的 HEIC 由服务端按内容判定，不靠猜。
  assert.equal(isHeicFile({ type: "image/jpeg", name: "IMG_0001.HEIC" }), false);
  assert.equal(isHeicFile({ type: "", name: "IMG_0001.HEIC" }), true);
  assert.equal(isHeicFile({ type: "", name: "IMG_0001.heic.bak" }), false);
});
