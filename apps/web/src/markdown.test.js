import assert from "node:assert/strict";
import test from "node:test";
import { isMarkdown, plainMarkdown, renderMarkdown } from "./markdown.js";

test("markdown is detected only when a real marker is present", () => {
  assert.equal(isMarkdown("# heading"), true);
  assert.equal(isMarkdown("- item"), true);
  assert.equal(isMarkdown("1. first"), true);
  assert.equal(isMarkdown("**bold**"), true);
  assert.equal(isMarkdown("`code`"), true);
  assert.equal(isMarkdown("[link](https://example.com)"), true);
  assert.equal(isMarkdown("> quote"), true);
  assert.equal(isMarkdown("```\ncode\n```"), true);
  assert.equal(isMarkdown("hello world"), false);
  assert.equal(isMarkdown(""), false);
  assert.equal(isMarkdown("2. not a list start"), false);
});

test("headings, emphasis and code render", () => {
  assert.equal(renderMarkdown("# Title"), "<h1>Title</h1>");
  assert.equal(renderMarkdown("**bold** and *it*"), "<p><strong>bold</strong> and <em>it</em></p>");
  assert.equal(renderMarkdown("`a < b`"), "<p><code>a &lt; b</code></p>");
});

test("raw HTML is escaped, never injected", () => {
  assert.equal(
    renderMarkdown("<script>alert(1)</script>"),
    "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>"
  );
});

test("links allow only http, https and fragments", () => {
  assert.equal(
    renderMarkdown("[site](https://example.com)"),
    '<p><a href="https://example.com/" rel="noopener noreferrer" target="_blank">site</a></p>'
  );
  assert.equal(renderMarkdown("[bad](javascript:alert(1))"), "<p>bad</p>");
  assert.equal(renderMarkdown("[bad](data:text/html,x)"), "<p>bad</p>");
});

test("lists and blockquotes render", () => {
  assert.equal(renderMarkdown("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
  assert.equal(renderMarkdown("1. one\n2. two"), "<ol><li>one</li><li>two</li></ol>");
  assert.equal(renderMarkdown("> quote"), "<blockquote><p>quote</p></blockquote>");
});

test("fenced code blocks render escaped", () => {
  assert.equal(renderMarkdown("```\nconst a = 1;\n```"), "<pre><code>const a = 1;</code></pre>");
});

test("plain preview strips the markdown markers", () => {
  assert.equal(plainMarkdown("**bold** and [link](https://x.com)"), "bold and link");
  assert.equal(plainMarkdown("# Title\n- item"), "Title\nitem");
  assert.equal(plainMarkdown("[x](https://a.com/b(1))"), "x");
  assert.equal(plainMarkdown("![photo](https://x/a.png)"), "photo");
  assert.equal(plainMarkdown("`code [not link](x)` and [real](https://x)"), "code not link and real");
  assert.equal(plainMarkdown("~~~\nconst a = 1;\n~~~"), "");
});

test("a table-only body is not treated as markdown", () => {
  assert.equal(isMarkdown("| a | b |"), false);
  assert.equal(renderMarkdown("| a | b |"), "<p>| a | b |</p>");
});
