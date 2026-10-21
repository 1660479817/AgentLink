import test from "node:test";
import assert from "node:assert/strict";
import {
  containsImage,
  documentDescription,
  documentTitle,
  firstLine,
  isMarkdown,
  toHtml,
  toPlain,
  toRuns,
} from "../src/index.js";

test("markdown is detected only when a real marker is present", () => {
  assert.equal(isMarkdown("这是一条普通的信息"), false);
  assert.equal(isMarkdown("snake_case_name"), false);
  assert.equal(isMarkdown("2.5 元"), false);
  assert.equal(isMarkdown("# 标题"), true);
  assert.equal(isMarkdown("**重点**"), true);
  assert.equal(isMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |"), true);
  assert.equal(isMarkdown("https://wang.xknot.si/discover"), true);
});

test("raw html is text, not markup", () => {
  const html = toHtml('<script>alert("x")</script>\n\n<img src=x onerror=alert(1)>');
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("&lt;script&gt;"), true);
});

test("links and images only allow http, https, site paths and anchors", () => {
  const ok = toHtml("[站内](/discover?post=1) [锚点](#top) [外链](https://example.com/a)");
  assert.match(ok, /href="\/discover\?post=1"/);
  assert.match(ok, /href="#top"/);
  assert.match(ok, /href="https:\/\/example\.com\/a"/);

  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example/x", "vbscript:x"]) {
    const html = toHtml(`[x](${bad})`);
    assert.equal(html.includes("<a "), false, bad);
    assert.equal(html.includes("javascript:"), false, bad);
  }

  const image = toHtml("![x](data:image/svg+xml,<svg/onload=alert(1)>)");
  assert.equal(image.includes("<img"), false);
});

test("plain text drops markers but keeps line structure", () => {
  const body = "# 报价说明\n\n**含税**，`CNY`\n\n- [x] 完成\n- ~~删除~~";
  assert.equal(toPlain(body), "报价说明\n\n含税，CNY\n\n完成\n删除");
  assert.equal(toPlain("普通文字 https://example.com"), "普通文字 https://example.com");
});

test("download name comes from the first plain line", () => {
  assert.equal(firstLine("# 报价说明\n第二行"), "报价说明");
  assert.equal(firstLine("**重要** 资料"), "重要 资料");
  assert.equal(firstLine("   "), "");
  assert.equal(firstLine("```\ncode\n```"), "");
});

test("runs flatten tables and keep list numbering", () => {
  const runs = toRuns("3. 第三\n4. 第四\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.deepEqual(
    runs.map((run) => run.prefix ?? null).filter(Boolean),
    ["3.", "4."]
  );
  const table = runs.filter((run) => run.type === "paragraph" && !run.prefix).map((run) => run.segments.map((s) => s.text).join(""));
  assert.deepEqual(table, ["a b", "1 2"]);
});

test("runs carry emphasis, code and links", () => {
  const [run] = toRuns("**粗** *斜* `码` [链](https://example.com)");
  assert.deepEqual(
    run.segments.map(({ text, bold, italic, code, link }) => ({ text, bold, italic, code, link })),
    [
      { text: "粗", bold: true, italic: false, code: false, link: null },
      { text: " ", bold: false, italic: false, code: false, link: null },
      { text: "斜", bold: false, italic: true, code: false, link: null },
      { text: " ", bold: false, italic: false, code: false, link: null },
      { text: "码", bold: false, italic: false, code: true, link: null },
      { text: " ", bold: false, italic: false, code: false, link: null },
      { text: "链", bold: false, italic: false, code: false, link: "https://example.com/" },
    ]
  );
});

test("a card opens on its own when the body holds an image", () => {
  assert.equal(containsImage("![x](https://example.com/a.png)"), true);
  assert.equal(containsImage("- ![x](https://example.com/a.png)"), true);
  assert.equal(containsImage("> ![x](https://example.com/a.png)"), true);
  assert.equal(containsImage("| a |\n| --- |\n| ![x](https://example.com/a.png) |"), true);
  assert.equal(containsImage("```\n![x](https://example.com/a.png)\n```"), false);
  assert.equal(containsImage("普通文字"), false);
  assert.equal(containsImage("![x](javascript:alert(1))"), false);
});

test("document title and description come from the same tree", () => {
  const md = "# 访问 Knot\n\nKnot 是**信息交换网**。\n\n## 下一步\n";
  assert.equal(documentTitle(md), "访问 Knot");
  assert.equal(documentDescription(md), "Knot 是信息交换网。");
  assert.equal(documentTitle("没有标题"), "");
  assert.equal(documentDescription("- 只有列表"), "只有列表");
});

test("headings, tables and alignment are serialized consistently", () => {
  const html = toHtml("#### 四级\n\n| 左 | 中 | 右 |\n| :-- | :-: | --: |\n| a | b | c |");
  assert.match(html, /<h4>四级<\/h4>/);
  assert.match(html, /<th class="md-left">左<\/th>/);
  assert.match(html, /<th class="md-center">中<\/th>/);
  assert.match(html, /<th class="md-right">右<\/th>/);
  assert.match(html, /<td class="md-center">b<\/td>/);

  const clamped = toHtml("#### 四级", { maxHeading: 3, tableClass: "table-wrap" });
  assert.equal(clamped, "<h3>四级</h3>");
});
