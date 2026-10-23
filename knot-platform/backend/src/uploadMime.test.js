import assert from "node:assert/strict";
import test from "node:test";
import { isInlineRenderableMime, safeAttachmentMime, safeAudioMime } from "./uploadStore.js";

// 这一组测的是「浏览器拿到的类型由谁决定」。客户端的声明只能当线索：
// 存成 text/html 再原样回给浏览器，就是一个同源脚本。

test("a declared audio type is kept, and the extension normalises it when it can", () => {
  assert.equal(safeAudioMime("audio/mpeg", "song.mp3"), "audio/mpeg");
  assert.equal(safeAudioMime("audio/x-m4a", "song.m4a"), "audio/mp4");
  // 扩展名认得出来时按扩展名归一，认不出来时保留声明值（两者都是 audio，不会被当页面渲染）。
  assert.equal(safeAudioMime("audio/mpeg", "song.unknown"), "audio/mpeg");
});

test("a non-audio declared type is replaced by the extension, or refused", () => {
  assert.equal(safeAudioMime("text/html", "evil.mp3"), "audio/mpeg");
  assert.equal(safeAudioMime("application/octet-stream", "song.flac"), "audio/flac");
  // 声明和文件名都说不出这是音频：宁可不收，也不猜。
  assert.equal(safeAudioMime("text/html", "evil.html"), "");
});

test("an attachment never keeps a type the browser would execute", () => {
  assert.equal(safeAttachmentMime("text/html"), "application/octet-stream");
  assert.equal(safeAttachmentMime("image/svg+xml"), "application/octet-stream");
  assert.equal(safeAttachmentMime("application/xhtml+xml"), "application/octet-stream");
  assert.equal(safeAttachmentMime("application/pdf"), "application/pdf");
  assert.equal(safeAttachmentMime(""), "application/octet-stream");
});

test("only media types render in place; everything else is handed over as a download", () => {
  assert.equal(isInlineRenderableMime("image/png"), true);
  assert.equal(isInlineRenderableMime("audio/mpeg"), true);
  assert.equal(isInlineRenderableMime("video/mp4"), true);
  // 这三类浏览器会当页面或脚本执行，不能内联。
  assert.equal(isInlineRenderableMime("text/html"), false);
  assert.equal(isInlineRenderableMime("image/svg+xml"), false);
  assert.equal(isInlineRenderableMime("application/xhtml+xml"), false);
  assert.equal(isInlineRenderableMime(""), false);
});

test("a charset on the declared type does not slip past the check", () => {
  assert.equal(isInlineRenderableMime("text/html; charset=utf-8"), false);
  assert.equal(safeAttachmentMime("TEXT/HTML; charset=utf-8"), "application/octet-stream");
  assert.equal(safeAudioMime("AUDIO/MPEG", "song.mp3"), "audio/mpeg");
});
