import assert from "node:assert/strict";
import test from "node:test";
import { isMarkdown, plainMarkdown, renderMarkdown } from "./markdown.js";

test("markdown is detected only when a real marker is present", () => {
  assert.equal(isMarkdown("# heading"), true);
  assert.equal(isMarkdown("- item"), true);
  assert.equal(isMarkdown("1. first"), true);
  assert.equal(isMarkdown("2. second"), true);
  assert.equal(isMarkdown("**bold**"), true);
  assert.equal(isMarkdown("`code`"), true);
  assert.equal(isMarkdown("[link](https://example.com)"), true);
  assert.equal(isMarkdown("> quote"), true);
  assert.equal(isMarkdown("```\ncode\n```"), true);
  assert.equal(isMarkdown("| a | b |\n| --- | --- |"), true);
  assert.equal(isMarkdown("见 https://example.com/a"), true);
  assert.equal(isMarkdown("_斜体_"), true);
  assert.equal(isMarkdown("标题\n===="), true);
  assert.equal(isMarkdown("hello world"), false);
  assert.equal(isMarkdown(""), false);
  assert.equal(isMarkdown("2.not a list"), false);
  assert.equal(isMarkdown("snake_case_name"), false);
});

test("headings, emphasis and code render", () => {
  assert.equal(renderMarkdown("# Title"), "<h1>Title</h1>");
  assert.equal(renderMarkdown("**bold** and *it*"), "<p><strong>bold</strong> and <em>it</em></p>");
  assert.equal(renderMarkdown("`a < b`"), "<p><code>a &lt; b</code></p>");
  assert.equal(renderMarkdown("## 标题 ##"), "<h2>标题</h2>");
  assert.equal(renderMarkdown("标题\n===="), "<h1>标题</h1>");
  assert.equal(renderMarkdown("副标题\n----"), "<h2>副标题</h2>");
});

test("emphasis nests and underscore stays out of words", () => {
  assert.equal(
    renderMarkdown("**粗体里有 *斜体* 和 `代码`**"),
    "<p><strong>粗体里有 <em>斜体</em> 和 <code>代码</code></strong></p>"
  );
  assert.equal(renderMarkdown("***重要***"), "<p><strong><em>重要</em></strong></p>");
  assert.equal(renderMarkdown("_斜体_ 与 snake_case_name"), "<p><em>斜体</em> 与 snake_case_name</p>");
  assert.equal(renderMarkdown("~~删除~~"), "<p><del>删除</del></p>");
});

test("raw HTML is escaped, never injected", () => {
  assert.equal(
    renderMarkdown("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
  );
  assert.equal(renderMarkdown("<javascript:alert(1)>"), "<p>&lt;javascript:alert(1)&gt;</p>");
});

test("links allow only http, https and fragments", () => {
  assert.equal(
    renderMarkdown("[site](https://example.com)"),
    '<p><a href="https://example.com/" rel="noopener noreferrer" target="_blank">site</a></p>'
  );
  assert.equal(renderMarkdown("[bad](javascript:alert(1))"), "<p>bad</p>");
  assert.equal(renderMarkdown("[bad](data:text/html,x)"), "<p>bad</p>");
});

test("bare and angle-bracket links become anchors", () => {
  assert.equal(
    renderMarkdown("见 https://example.com/a?b=1。"),
    '<p>见 <a href="https://example.com/a?b=1" rel="noopener noreferrer" target="_blank">https://example.com/a?b=1</a>。</p>'
  );
  assert.equal(
    renderMarkdown("见 <https://example.com/a> 这一篇"),
    '<p>见 <a href="https://example.com/a" rel="noopener noreferrer" target="_blank">https://example.com/a</a> 这一篇</p>'
  );
  assert.equal(renderMarkdown("xhttps://example.com"), "<p>xhttps://example.com</p>");
});

test("links never nest", () => {
  assert.equal(
    renderMarkdown("[see https://inner.com](https://outer.com)"),
    '<p><a href="https://outer.com/" rel="noopener noreferrer" target="_blank">see https://inner.com</a></p>'
  );
  assert.equal(
    renderMarkdown("[a [b](https://b.com)](https://a.com)"),
    '<p><a href="https://a.com/" rel="noopener noreferrer" target="_blank">a b</a></p>'
  );
});

test("lists and blockquotes render", () => {
  assert.equal(renderMarkdown("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderMarkdown("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  assert.equal(renderMarkdown("> quote"), "<blockquote><p>quote</p></blockquote>");
  assert.equal(renderMarkdown("3. three\n4. four"), '<ol start="3"><li>three</li><li>four</li></ol>');
});

test("list items keep nested levels and continuation lines", () => {
  assert.equal(
    renderMarkdown("- 甲\n  - 甲一\n  - 甲二\n- 乙"),
    "<ul><li>甲<ul><li>甲一</li><li>甲二</li></ul></li><li>乙</li></ul>"
  );
  assert.equal(
    renderMarkdown("- 第一条，写了很长\n  续行说明\n- 第二条"),
    "<ul><li>第一条，写了很长\n续行说明</li><li>第二条</li></ul>"
  );
  assert.equal(
    renderMarkdown("1. 一\n   - 甲\n   - 乙\n2. 二"),
    '<ol><li>一<ul><li>甲</li><li>乙</li></ul></li><li>二</li></ol>'
  );
});

test("task lists keep their checkboxes", () => {
  assert.equal(
    renderMarkdown("- [ ] 待办\n- [x] 完成"),
    '<ul class="md-tasks"><li class="md-task"><input type="checkbox" disabled aria-hidden="true"> 待办</li><li class="md-task"><input type="checkbox" disabled checked aria-hidden="true"> 完成</li></ul>'
  );
});

test("escapes and hard breaks survive", () => {
  assert.equal(renderMarkdown("\\*不是斜体\\*"), "<p>*不是斜体*</p>");
  assert.equal(renderMarkdown("1\\. 不是列表"), "<p>1. 不是列表</p>");
  assert.equal(renderMarkdown("第一行  \n第二行"), "<p>第一行<br>第二行</p>");
  assert.equal(renderMarkdown("第一行\\\n第二行"), "<p>第一行<br>第二行</p>");
});

test("fenced code blocks render escaped", () => {
  assert.equal(renderMarkdown("```\nconst a = 1;\n```"), "<pre><code>const a = 1;</code></pre>");
});

test("tables render as tables", () => {
  assert.equal(
    renderMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |"),
    '<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
  );
  assert.equal(
    renderMarkdown("a | b\n--- | ---\n1 | 2"),
    '<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
  );
});

test("table alignment, escaped pipes and code spans", () => {
  assert.equal(
    renderMarkdown("| L | C | R |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |"),
    '<div class="md-table"><table><thead><tr><th class="md-left">L</th><th class="md-center">C</th><th class="md-right">R</th></tr></thead><tbody><tr><td class="md-left">1</td><td class="md-center">2</td><td class="md-right">3</td></tr></tbody></table></div>'
  );
  assert.equal(
    renderMarkdown("| a \\| b | c |\n| --- | --- |\n| x | y |"),
    '<div class="md-table"><table><thead><tr><th>a | b</th><th>c</th></tr></thead><tbody><tr><td>x</td><td>y</td></tr></tbody></table></div>'
  );
  assert.equal(
    renderMarkdown("| 表达式 | 说明 |\n| --- | --- |\n| `a|b` | 管道 |"),
    '<div class="md-table"><table><thead><tr><th>表达式</th><th>说明</th></tr></thead><tbody><tr><td><code>a|b</code></td><td>管道</td></tr></tbody></table></div>'
  );
  assert.equal(
    renderMarkdown("| a | b |\n| --- | --- |\n| 1 |"),
    '<div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td></td></tr></tbody></table></div>'
  );
});

test("a table following a paragraph starts its own block", () => {
  assert.equal(
    renderMarkdown("before\n| a | b |\n| --- | --- |\n| 1 | 2 |"),
    '<p>before</p><div class="md-table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
  );
  assert.equal(renderMarkdown("| a | b |"), "<p>| a | b |</p>");
});

test("table cells are escaped like other inline text", () => {
  assert.equal(
    renderMarkdown("| a |\n| --- |\n| <script>x</script> |"),
    '<div class="md-table"><table><thead><tr><th>a</th></tr></thead><tbody><tr><td>&lt;script&gt;x&lt;/script&gt;</td></tr></tbody></table></div>'
  );
});

test("plain preview strips the markdown markers", () => {
  assert.equal(plainMarkdown("**bold** and [link](https://x.com)"), "bold and link");
  assert.equal(plainMarkdown("# Title\n- item"), "Title\nitem");
  assert.equal(plainMarkdown("[x](https://a.com/b(1))"), "x");
  assert.equal(plainMarkdown("![photo](https://x/a.png)"), "photo");
  assert.equal(plainMarkdown("`code [not link](x)` and [real](https://x)"), "code not link and real");
  assert.equal(plainMarkdown("~~~\nconst a = 1;\n~~~"), "");
  assert.equal(plainMarkdown("| a | b |\n| --- | --- |\n| 1 | 2 |"), "a b\n1 2");
  assert.equal(plainMarkdown("- [x] 完成"), "完成");
  assert.equal(plainMarkdown("\\*不是斜体\\*"), "*不是斜体*");
  assert.equal(plainMarkdown("见 <https://example.com/a> 这一篇"), "见 https://example.com/a 这一篇");
  assert.equal(plainMarkdown("**a *b* c**"), "a b c");
  assert.equal(plainMarkdown("snake_case_name"), "snake_case_name");
});
