import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { attachmentOpens } from "./readable.js";

function pdf(extra = "") {
  return Buffer.from(`%PDF-1.6\n1 0 obj\n<< /Type /Catalog >>\nendobj\n${extra}trailer\n<< /Size 2 /Root 1 0 R >>\nstartxref\n0\n%%EOF`, "latin1");
}

function zip(name, data) {
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(fileName.length, 26);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  return Buffer.concat([local, fileName, data]);
}

test("a plain pdf, office file, and markdown can be opened", () => {
  assert.equal(attachmentOpens("笔记.pdf", pdf("正文里提到 /Encrypt 这个词。\n")), true);
  assert.equal(attachmentOpens("报价.docx", zip("word/document.xml", Buffer.from("<w:document/>"))), true);
  assert.equal(attachmentOpens("表.xlsx", zip("xl/workbook.xml", Buffer.from("<workbook/>"))), true);
  assert.equal(attachmentOpens("稿.pptx", zip("ppt/presentation.xml", Buffer.from("<p:presentation/>"))), true);
  assert.equal(attachmentOpens("说明.md", Buffer.from("曾国藩传\n")), true);
});

test("a locked or damaged attachment cannot be opened", () => {
  const locked = pdf(`2 0 obj\n<< /Filter /Standard /V 4 /R 4 /Length 128 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> /P -1340 >>\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R /Encrypt 2 0 R /ID [<${"11".repeat(16)}>] >>\nstartxref\n0\n%%EOF`);
  assert.equal(attachmentOpens("书.pdf", locked), false);
  assert.equal(attachmentOpens("坏.pdf", Buffer.from("not a pdf")), false);
  assert.equal(attachmentOpens("密.docx", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])), false);
  assert.equal(attachmentOpens("密.xlsx", zip("EncryptionInfo", Buffer.from("x"))), false);
  assert.equal(attachmentOpens("二进制.md", Buffer.from([0x00, 0x61])), false);
  assert.equal(attachmentOpens("改名.md", Buffer.from("%PDF-1.6\n")), false);
});

test("an encrypted pdf with an empty user password can still be opened", () => {
  const fileId = Buffer.from("11".repeat(16), "hex");
  const salt = Buffer.from("22".repeat(8), "hex");
  const hash = createHash("sha256").update(salt).digest();
  const u = Buffer.concat([hash, salt, Buffer.alloc(8)]).toString("hex");
  const o = "ab".repeat(48);
  const body = pdf(`2 0 obj\n<< /Filter /Standard /V 5 /R 5 /Length 256 /O <${o}> /U <${u}> /P -1340 >>\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R /Encrypt 2 0 R /ID [<${fileId.toString("hex")}>] >>\nstartxref\n0\n%%EOF`);
  assert.equal(attachmentOpens("权限.pdf", body), true);
  const wrong = body.toString("latin1").replace(u, "00".repeat(48));
  assert.equal(attachmentOpens("权限.pdf", Buffer.from(wrong, "latin1")), false);
});
