import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { archiveSources, buildZip, ensurePacketZip, packetDownloadName, packetReadme } from "./packetZip.js";
import { derivedDir } from "./storage.js";

const INTEL = "33333333-3333-4333-8333-333333333333";

function unzip(buffer) {
  const files = [];
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const method = buffer.readUInt16LE(offset + 8);
    const crc = buffer.readUInt32LE(offset + 14);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLen).toString("utf8");
    const start = offset + 30 + nameLen + extraLen;
    const data = buffer.subarray(start, start + size);
    assert.equal(method, 0);
    assert.equal(buffer.readUInt16LE(offset + 6) & 0x800, 0x800);
    files.push({ name, data, crc });
    offset = start + size;
  }
  assert.equal(buffer.readUInt32LE(buffer.length - 22), 0x06054b50);
  return files;
}

test("readme lists the structure and then the body", () => {
  const text = packetReadme({
    category: "市场",
    price: 10,
    author: "林",
    createdAt: "2026-10-12T12:52:00.000Z",
    videos: [{ url: "https://example.com/watch" }],
    files: [
      { label: "图片", name: "1.jpg" },
      { label: "音频", name: "说明.m4a" },
      { label: "附件", name: "报价.pdf" },
    ],
    body: "这里是帖子正文。",
  });
  assert.equal(
    text,
    [
      "类别：市场",
      "报价：10",
      "作者：林",
      "时间：2026-10-12 20:52",
      "视频：https://example.com/watch",
      "图片：1.jpg",
      "音频：说明.m4a",
      "附件：报价.pdf",
      "",
      "这里是帖子正文。",
      "",
    ].join("\n")
  );
});

test("an empty structure line is left out", () => {
  const text = packetReadme({ price: 0, body: "" });
  assert.equal(text, "报价：0\n\n\n");
});

test("a download packet keeps attachments and leaves images and audio out", () => {
  const files = archiveSources([
    { mime: "application/pdf", original_name: "报价.pdf", storage_name: "c" },
    { mime: "image/png", original_name: "readme.txt", storage_name: "a" },
    { mime: "image/png", original_name: "1.jpg", storage_name: "b" },
    { mime: "audio/mpeg", original_name: "说明.m4a", storage_name: "d" },
    { mime: "application/zip", original_name: "材料.zip", storage_name: "e" },
  ]);
  assert.deepEqual(
    files.map((file) => `${file.label}:${file.name}`),
    ["附件:报价.pdf", "附件:材料.zip"]
  );
});

test("the download name comes from the first line of the body", () => {
  assert.equal(packetDownloadName("报价说明\n第二行"), "报价说明.zip");
  assert.equal(packetDownloadName("# 报价说明"), "报价说明.zip");
  assert.equal(packetDownloadName("  "), "packet.zip");
  assert.equal(packetDownloadName("a/b:c"), "abc.zip");
});

test("the first download builds one zip and the next one reuses it", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knot-zip-"));
  const upload = path.join(root, "uploads");
  fs.mkdirSync(upload);
  fs.mkdirSync(path.join(upload, "blobs"), { recursive: true });
  fs.writeFileSync(path.join(upload, "pic.bin"), "file-bytes");
  const sources = archiveSources([{ mime: "application/pdf", original_name: "报价.pdf", storage_name: "pic.bin" }]);
  const readme = packetReadme({
    price: 10,
    author: "林",
    createdAt: "2026-10-12T12:52:00.000Z",
    body: "正文",
    files: sources,
  });
  const first = await ensurePacketZip(upload, INTEL, readme, sources);
  fs.rmSync(path.join(upload, "pic.bin"));
  const second = await ensurePacketZip(upload, INTEL, "changed\n", sources);
  assert.equal(first, second);
  const packed = unzip(fs.readFileSync(first));
  assert.equal(packed.find((file) => file.name === "readme.txt").data.toString("utf8"), readme);
  assert.equal(packed.find((file) => file.name === "报价.pdf").data.toString("utf8"), "file-bytes");
  fs.rmSync(root, { recursive: true, force: true });
});

test("a missing source file does not leave a zip", async () => {  const root = fs.mkdtempSync(path.join(os.tmpdir(), "knot-zip-"));
  const upload = path.join(root, "uploads");
  fs.mkdirSync(upload);
  const sources = [{ label: "图片", name: "图.png", storageName: "missing.bin" }];
  await assert.rejects(
    ensurePacketZip(upload, INTEL, "报价：10\n\n\n", sources),
    (error) => error.code === "packet_unavailable"
  );
  assert.equal(fs.existsSync(path.join(derivedDir(upload, "packets"), `${INTEL}.zip`)), false);
  fs.rmSync(root, { recursive: true, force: true });
});

// ZIP 的条目数与大小字段分别是 16 位与 32 位。超了 writeUInt16LE/32LE 会抛 RangeError，
// 到调用方就变成 500；这里先给出一个明确的 packet_too_large。
test("a packet beyond the zip format limits fails clearly instead of a RangeError", () => {
  const empty = Buffer.alloc(0);
  const many = Array.from({ length: 0x10000 }, (_item, index) => ({ name: `${index}.txt`, data: empty }));
  assert.throws(() => buildZip(many), (error) => error.code === "packet_too_large");
  assert.throws(() => buildZip([{ name: "x".repeat(0x10000), data: empty }]), (error) => error.code === "packet_too_large");
});
