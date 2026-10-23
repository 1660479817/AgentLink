import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import { execute, extractDocumentText, readDocument } from "./index.mjs";

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30 + name.length + compressed.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    compressed.copy(local, 30 + name.length);
    locals.push(local);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, eocd]);
}

function pdf(text) {
  const stream = `BT /F1 24 Tf 40 100 Td (${text}) Tj ET`;
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xref = body.length;
  let table = `xref\n0 6\n0000000000 65535 f \n`;
  for (let n = 1; n <= 5; n += 1) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  body += `${table}trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("markdown, word, excel, and slides return their text", async () => {
  const note = await readDocument("note.md", Buffer.from("# 标题\n正文"));
  assert.equal(note.ok, true);
  assert.equal(note.kind, "markdown");
  assert.match(note.text, /正文/);

  const doc = zip([
    { name: "word/document.xml", data: "<w:document><w:p><w:r><w:t>曾国藩传</w:t></w:r></w:p><w:p><w:r><w:t>高清晰度</w:t></w:r></w:p></w:document>" },
    { name: "word/header1.xml", data: "<w:hdr><w:p><w:r><w:t>页眉</w:t></w:r></w:p></w:hdr>" },
  ]);
  const word = await readDocument("book.docx", doc);
  assert.equal(word.kind, "docx");
  assert.match(word.text, /曾国藩传\n高清晰度\n页眉/);

  const book = zip([
    { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="报价" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Type="sheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: "xl/sharedStrings.xml", data: "<sst><si><t>名称</t></si><si><t>曾国藩</t></si></sst>" },
    { name: "xl/worksheets/sheet1.xml", data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2"><v>10</v></c></row></sheetData></worksheet>' },
  ]);
  const sheet = await readDocument("price.xlsx", book);
  assert.equal(sheet.kind, "xlsx");
  assert.match(sheet.text, /工作表 报价/);
  assert.match(sheet.text, /名称\t曾国藩/);
  assert.match(sheet.text, /^10/m);

  const deck = zip([
    { name: "ppt/presentation.xml", data: '<p:presentation><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId1"/></p:sldIdLst></p:presentation>' },
    { name: "ppt/_rels/presentation.xml.rels", data: '<Relationships><Relationship Id="rId1" Type="slide" Target="slides/slide1.xml"/><Relationship Id="rId2" Type="slide" Target="slides/slide2.xml"/></Relationships>' },
    { name: "ppt/slides/slide1.xml", data: "<p:sld><a:t>后一页</a:t></p:sld>" },
    { name: "ppt/slides/slide2.xml", data: "<p:sld><p:sp><a:p><a:r><a:t>封面</a:t></a:r></a:p></p:sp></p:sld>" },
  ]);
  const slides = await readDocument("deck.pptx", deck);
  assert.equal(slides.kind, "pptx");
  assert.match(slides.text, /幻灯片 1[\s\S]*封面/);
  assert.match(slides.text, /幻灯片 2[\s\S]*后一页/);
});

test("a pdf page is read through the local engine", async () => {
  const result = await readDocument("note.pdf", pdf("Hello Knot"));
  if (result.error === "pdf_engine_missing") return;
  assert.equal(result.ok, true);
  assert.equal(result.kind, "pdf");
  assert.match(result.text, /Hello Knot/);
});

test("stored document text keeps the whole readable file", async () => {
  const body = `传感器${"甲".repeat(13000)}结尾`;
  const text = await extractDocumentText("手册.md", Buffer.from(body));
  assert.equal(text.startsWith("传感器"), true);
  assert.equal(text.endsWith("结尾"), true);
  assert.equal(await extractDocumentText("空.bin", Buffer.from([0, 1, 2])), "");
});

test("a locked path and a foreign file are refused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knot-read-"));
  const inside = path.join(root, "note.md");
  await writeFile(inside, "只在允许的目录里");
  const opened = await execute(["--file", inside], { root });
  assert.equal(opened.body.ok, true);
  assert.match(opened.body.text, /允许的目录/);

  const outside = await execute(["--file", "/etc/hosts"], { root });
  assert.equal(outside.body.ok, false);
  assert.equal(outside.body.error, "bad_file");
  const relative = await execute(["--file", "note.md"], { root });
  assert.equal(relative.code, 2);
});

test("later parts stay available", async () => {
  const result = await readDocument("note.md", Buffer.from(`${"甲".repeat(8000)}\n${"乙".repeat(20)}`));
  assert.ok(result.parts > 1);
  const last = await readDocument("note.md", Buffer.from(`${"甲".repeat(8000)}\n${"乙".repeat(20)}`), { part: result.parts });
  assert.match(last.text, /乙/);
});

// 压缩包会把输入放大的倍数交给攻击者定：几十 MB 的 zip 解出几十 GB 只要几行脚本，
// 而解压发生在进程内。这两条测的是「在解之前就停住」。

test("a zip with too many entries is refused", async () => {
  const entries = Array.from({ length: 3000 }, (_, i) => ({ name: `n${i}.txt`, data: "x" }));
  const result = await readDocument("many.docx", zip(entries));
  assert.equal(result.ok, false);
  assert.equal(result.error, "unreadable");
});

test("an entry that declares more than the cap is refused without inflating it", async () => {
  // 声明值先挡一道：解压前就能看出这条会放大到 40 MB，不必真的去解。
  const bomb = Buffer.alloc(40 * 1024 * 1024);
  const result = await readDocument("bomb.docx", zip([{ name: "word/document.xml", data: bomb }]));
  assert.equal(result.ok, false);
  assert.equal(result.error, "unreadable");
  assert.equal(await extractDocumentText("bomb.docx", zip([{ name: "word/document.xml", data: bomb }])), "");
});
