import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAGE_PATH, RAW_PATH, SLUG, SOURCE, writeKnotHelp } from "./render-knot-help.mjs";

// 这一页是所有 Knot 实例共用的协议说明，挂在门户上。
// 排版归 ops/doc-page.mjs；这里只管「哪一份文档、挂在哪两个地址」。

const DOC = readFileSync(SOURCE, "utf8");
const HUB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("源文件是仓库根 docs/ 的那一份，不是某个项目的副本", () => {
  // 公共文档只有一份：根 docs/KNOT_HELP.md。项目目录里再出现同名文件就是分叉。
  assert.equal(SOURCE, path.resolve(HUB, "..", "docs", "KNOT_HELP.md"));
  assert.equal(path.basename(SOURCE), "KNOT_HELP.md");
});

test("两个地址与 slug 对得上 nginx 与构建脚本", () => {
  assert.equal(SLUG, "knot-help");
  assert.equal(PAGE_PATH, "/knot-help");
  assert.equal(RAW_PATH, "/knot-help.md");
  // 产物名必须与 conf 里的 try_files 一致，否则线上就是 404。
  const conf = readFileSync(path.join(HUB, "ops", "xknot.si.conf"), "utf8");
  assert.match(conf, new RegExp(`try_files /${SLUG}\\.html =404;`));
  assert.match(conf, new RegExp(`location = ${RAW_PATH.replace(/\./g, "\\.")}`));
});

test("发布产物：原文一字不改，HTML 有正文与样式", () => {
  const out = mkdtempSync(path.join(tmpdir(), "knot-help-"));
  try {
    writeKnotHelp({ out });
    const raw = readFileSync(path.join(out, `${SLUG}.md`), "utf8");
    const html = readFileSync(path.join(out, `${SLUG}.html`), "utf8");
    // Agent 读到的必须是同一份原文，不是被转义过的副本。
    assert.equal(raw, DOC);
    assert.match(html, /<html lang="en">/);
    assert.match(html, /<title>Knot Agent API Guide · XKnot<\/title>/);
    assert.match(html, /Authorization: Bearer/);
    assert.match(html, /<link rel="canonical" href="\/knot-help">/);
    assert.match(html, /<style>/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("协议文档写明实例地址与本文地址是两回事", () => {
  // 路径接在实例地址后面，不接在读这份说明的地址后面。
  assert.match(DOC, /Instance address/);
  assert.doesNotMatch(DOC, /appended to the address you are reading/i);
  // 每个实例的策略不同，文档必须把这句话留给实例。
  assert.match(DOC, /each instance's own policy/);
});

test("中文只作对照稿：不进构建，也不改发出去的英文原文", () => {
  // 对照稿放在同一目录，方便翻译校对；发布只读 KNOT_HELP.md。
  // 删掉对照稿不影响构建，所以这里只在它还在时校验一眼。
  const reference = path.resolve(HUB, "..", "docs", "KNOT_HELP_CN.md");
  assert.notEqual(reference, SOURCE);
  if (existsSync(reference)) {
    assert.match(readFileSync(reference, "utf8"), /Knot Agent 接口指引/);
  }
});
