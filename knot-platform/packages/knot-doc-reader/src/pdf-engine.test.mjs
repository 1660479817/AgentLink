// PDF 走的是运行时动态 import：从 OPENCLAW_BIN 找到 openclaw，再加载
// 它自带的 clawpdf。这条路径依赖 node:url 的 pathToFileURL，
// 所以单独放一个文件（每个测试文件独立进程），用假引擎把它跑到。
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readDocument } from "./index.mjs";

test("a pdf is read through the engine found from OPENCLAW_BIN", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "knot-pdf-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));
  await mkdir(path.join(root, "bin"), { recursive: true });
  await writeFile(path.join(root, "bin", "openclaw"), "");

  const engine = path.join(root, "node_modules", "clawpdf", "dist");
  await mkdir(engine, { recursive: true });
  await writeFile(path.join(root, "node_modules", "clawpdf", "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    path.join(engine, "index.js"),
    `export async function openPdf() {
      return { pageCount: 1, getPageText: () => "Fake page", destroy() {} };
    }\n`
  );

  const previous = process.env.OPENCLAW_BIN;
  process.env.OPENCLAW_BIN = path.join(root, "bin", "openclaw");
  try {
    const result = await readDocument("note.pdf", Buffer.from("%PDF-1.4\n"));
    assert.equal(result.ok, true);
    assert.equal(result.kind, "pdf");
    assert.match(result.text, /Fake page/);
  } finally {
    if (previous === undefined) delete process.env.OPENCLAW_BIN;
    else process.env.OPENCLAW_BIN = previous;
  }
});
