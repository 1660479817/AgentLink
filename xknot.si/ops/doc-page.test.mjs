import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  escapeHtml,
  markdownDescription,
  markdownHtml,
  markdownTitle,
  renderDocPage,
  writeDocPage,
} from "./doc-page.mjs";

// 门户上所有静态文档页共用这一套排版。它由构建产出，没有运行时渲染：
// 写错了不会报错，只会静静发出去。

test("标题取一级标题，认不出就交给调用方兜底", () => {
  assert.equal(markdownTitle("# 访问 Knot\n\n正文\n"), "访问 Knot");
  assert.equal(markdownTitle("## 二级不算\n"), "");
  assert.equal(markdownTitle("没有标题\n"), "");
  // 代码块里写的 # 不是标题。
  assert.equal(markdownTitle("```\n# 不是标题\n```\n"), "");
  assert.equal(markdownTitle("```\n# 不是标题\n```\n\n# 真标题\n"), "真标题");
});

test("简介取标题后的第一个正文段落", () => {
  assert.equal(markdownDescription("# 访问 Knot\n\n第一段。\n\n第二段。\n"), "第一段。");
  // 标题后面的代码块、列表、表格都不算简介。
  assert.equal(markdownDescription("# T\n\n```\nx\n```\n\n真正的简介\n"), "真正的简介");
  assert.equal(markdownDescription("# T\n\n- 只有列表\n"), "");
  assert.equal(markdownDescription("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"), "");
  // 过长要截断，别把整段塞进 meta。
  assert.equal(markdownDescription("# T\n\n" + "字".repeat(400), { limit: 20 }), "字".repeat(20));
});

test("正文把 markdown 变成 HTML，宽表套上滚动层", () => {
  const html = markdownHtml("# T\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
  assert.match(html, /<h1>T<\/h1>/);
  assert.match(html, /<div class="table-wrap"><table>/);
  assert.match(html, /<\/table><\/div>/);
  // 代码块里的尖括号要转义，不能被浏览器当成标签。
  assert.match(markdownHtml("```\n<授权码>\n```"), /&lt;授权码&gt;/);
  assert.doesNotMatch(markdownHtml("```\n<授权码>\n```"), /<授权码>/);
});

test("外链带 rel，不把 opener 留给门户", () => {
  assert.match(markdownHtml("[站](https://wang.xknot.si)"), /<a href="https:\/\/wang\.xknot\.si" rel="noopener noreferrer">/);
  // 站内链接不加，跳自己的页面没有 opener 问题。
  assert.match(markdownHtml("[首页](/)"), /<a href="\/">/);
});

test("页面骨架：样式、标题、两个地址、标识", () => {
  const page = renderDocPage("# 指引\n\n简介。\n", {
    canonical: "/doc",
    rawPath: "/doc.md",
    brand: { name: "XKnot", mark: "X", href: "/" },
  });
  assert.match(page, /<title>指引 · XKnot<\/title>/);
  assert.match(page, /<meta name="description" content="简介。">/);
  assert.match(page, /<link rel="canonical" href="\/doc">/);
  assert.match(page, /<link rel="alternate" type="text\/markdown" href="\/doc\.md">/);
  assert.match(page, /<a class="raw" href="\/doc\.md">Markdown 原文<\/a>/);
  // 样式必须真的进页面：写在模块里却不引用，页面就会退化成浏览器默认排版。
  assert.match(page, /<style>:root \{/);
  assert.match(page, /\.table-wrap \{/);
});

test("没有标题、没有原文地址时不留空壳", () => {
  const page = renderDocPage("正文。\n", { brand: { name: "XKnot" } });
  assert.match(page, /<title>XKnot<\/title>/);
  assert.doesNotMatch(page, /<link rel="canonical"/);
  assert.doesNotMatch(page, /class="raw"/);
  assert.doesNotMatch(page, /<meta name="description"/);
  assert.match(renderDocPage("# <script>\n"), /<title>&lt;script&gt; · XKnot<\/title>/);
});

test("换品牌不改排版，只换格子里的字", () => {
  const page = renderDocPage("# 文档\n", { brand: { name: "Knot", mark: "K", href: "/home" } });
  assert.match(page, /<title>文档 · Knot<\/title>/);
  assert.match(page, /<a class="brand" href="\/home"><span class="mark" aria-hidden="true">K<\/span><span>Knot<\/span><\/a>/);
});

test("内联 HTML 不落进页面：同源执行一条 <script> 就能拿到 /api/admin", () => {
  const inline = markdownHtml('<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n');
  assert.doesNotMatch(inline, /<script/i);
  assert.doesNotMatch(inline, /<img/i);
  assert.match(inline, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(inline, /&lt;img src=&quot;x&quot; onerror=&quot;alert\(2\)&quot;&gt;/);
  // 正常的 markdown 不受影响。
  assert.match(markdownHtml("**粗体** 与 `code`"), /<strong>粗体<\/strong>/);
});

test("落盘：原文一字不改，HTML 有正文和样式", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "doc-page-"));
  const source = path.join(dir, "src.md");
  const markdown = "# 文档\n\n正文 **粗体**。\n";
  try {
    writeFileSync(source, markdown);
    const out = path.join(dir, "dist");
    const written = writeDocPage({ source, out, slug: "doc", canonical: "/doc", rawPath: "/doc.md" });
    assert.equal(readFileSync(path.join(out, "doc.md"), "utf8"), markdown);
    const html = readFileSync(path.join(out, "doc.html"), "utf8");
    assert.match(html, /<h1>文档<\/h1>/);
    assert.match(html, /<strong>粗体<\/strong>/);
    assert.match(html, /<style>/);
    assert.equal(written.html, path.join(out, "doc.html"));
    assert.equal(written.bytes, Buffer.byteLength(markdown));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("转义覆盖属性里的引号与 &", () => {
  assert.equal(escapeHtml(`a"b&c<d>`), "a&quot;b&amp;c&lt;d&gt;");
});
