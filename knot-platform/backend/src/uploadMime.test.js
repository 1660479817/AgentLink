import assert from "node:assert/strict";
import test from "node:test";
import { audioMimeFromHead, isInlineRenderableMime, safeAttachmentMime } from "./uploadStore.js";

// 这一组测的是「浏览器拿到的类型由谁决定」。客户端的声明只能当线索：
// 存成 text/html 再原样回给浏览器，就是一个同源脚本。

const head = (...bytes) => Buffer.from(bytes);

test("audio magic bytes are recognised, independent of the declared name", () => {
  assert.equal(audioMimeFromHead(head(0x49, 0x44, 0x33, 0x04)), "audio/mpeg"); // ID3
  assert.equal(audioMimeFromHead(head(0xff, 0xfb)), "audio/mpeg"); // 裸 MPEG 帧同步
  assert.equal(audioMimeFromHead(head(0x4f, 0x67, 0x67, 0x53)), "audio/ogg"); // OggS
  assert.equal(audioMimeFromHead(head(0x66, 0x4c, 0x61, 0x43)), "audio/flac"); // fLaC
  assert.equal(
    audioMimeFromHead(head(0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45)),
    "audio/wav"
  );
  assert.equal(audioMimeFromHead(head(0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70)), "audio/mp4"); // ftyp
  assert.equal(audioMimeFromHead(head(0xff, 0xf1)), "audio/aac"); // ADTS 同步字
  assert.equal(
    audioMimeFromHead(head(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9, 0x00, 0xaa, 0x00, 0x62, 0xce, 0x6c)),
    "audio/x-ms-wma"
  );
});

test("a non-audio head is refused: the extension no longer rescues it", () => {
  assert.equal(audioMimeFromHead(Buffer.from("<html><script>")), null);
  assert.equal(audioMimeFromHead(Buffer.from("<!DOCTYPE html>")), null);
  assert.equal(audioMimeFromHead(Buffer.from("GIF89a")), null);
  assert.equal(audioMimeFromHead(head(0x89, 0x50, 0x4e, 0x47)), null); // PNG 不是音频
  assert.equal(audioMimeFromHead(Buffer.from("")), null);
  assert.equal(audioMimeFromHead(head(0x52, 0x49, 0x46, 0x46)), null); // RIFF 但不是 WAVE
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
});
