import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { attachmentExtract, readExtract, renderExtract, saveReviewExtract, sectionHeading, writeExtract } from "./extracts.js";
import { derivedDir } from "./storage.js";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("an extract names each picture and file", () => {
  assert.equal(sectionHeading("image", 0, "海报.png"), "图片 1 海报.png");
  assert.equal(sectionHeading("file", 1, "说明\n#.md"), "附件 2 说明 .md");
  const body = renderExtract([
    { heading: "图片 1 海报.png", text: "一张海报" },
    { heading: "附件 1 说明.md", text: "" },
    { heading: "附件 2 手册.pdf", text: "传感器规格" },
  ]);
  assert.match(body, /^# 图片 1 海报.png\n\n一张海报\n\n# 附件 2 手册.pdf\n\n传感器规格\n$/);
});

test("a review extract is one markdown file and an empty pass removes it", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-extract-"));
  try {
    const written = await writeExtract(dir, ID, [{ heading: "图片 1", text: "传感器规格表" }]);
    assert.match(written, /传感器规格表/);
    assert.equal(await readExtract(dir, ID), written);
    assert.equal(await readFile(path.join(derivedDir(dir, "extracts"), `${ID}.md`), "utf8"), written);
    assert.equal(await writeExtract(dir, ID, []), "");
    await assert.rejects(readFile(path.join(derivedDir(dir, "extracts"), `${ID}.md`), "utf8"));
    assert.equal(await readExtract(dir, "not-an-id"), "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a document's extracted text is stored for search", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knot-extract-doc-"));
  const previous = process.env.UPLOAD_DIR;
  process.env.UPLOAD_DIR = dir;
  const file = path.join(dir, "手册.md");
  try {
    await writeFile(file, "这是传感器的安装说明。");
    const text = await attachmentExtract({ path: file, name: "手册.md" });
    assert.match(text, /传感器的安装说明/);
    await saveReviewExtract(ID, [{ heading: sectionHeading("file", 0, "手册.md"), text }]);
    assert.match(await readExtract(dir, ID), /# 附件 1 手册.md\n\n这是传感器的安装说明。/);
  } finally {
    if (previous === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
