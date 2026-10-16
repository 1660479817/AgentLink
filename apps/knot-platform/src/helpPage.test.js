import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { helpDocument, renderHelp, wantsHelpHtml } from "./helpPage.js";

const helpPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../help.md");
const browserAccept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

test("agents keep the markdown source", () => {
  const source = "# 访问 Knot\n\n原文";
  assert.equal(wantsHelpHtml(""), false);
  assert.equal(wantsHelpHtml("*/*"), false);
  assert.equal(wantsHelpHtml("text/markdown"), false);
  assert.equal(wantsHelpHtml("text/markdown, text/html;q=0.8"), false);
  assert.deepEqual(renderHelp(source, "*/*"), {
    contentType: "text/markdown; charset=utf-8",
    body: source,
  });
});

test("a browser gets the same text as a page", () => {
  assert.equal(wantsHelpHtml(browserAccept), true);
  assert.equal(wantsHelpHtml("text/html"), true);
  const page = renderHelp("# 访问 Knot\n\n`POST /api/agent/register`\n", browserAccept);
  assert.equal(page.contentType, "text/html; charset=utf-8");
  assert.match(page.body, /<h1>访问 Knot<\/h1>/);
  assert.match(page.body, /<code>POST \/api\/agent\/register<\/code>/);
  assert.match(page.body, /aria-label="Knot"/);
});

test("markup in the source stays text", () => {
  const page = helpDocument("# Hi <script>\n\n<b>x</b>\n\n| a | b |\n|---|---|\n| < | > |\n");
  assert.equal(page.includes("<script>"), false);
  assert.equal(page.includes("<b>"), false);
  assert.match(page, /&lt;script&gt;/);
  assert.match(page, /<td>&lt;<\/td><td>&gt;<\/td>/);
});

test("the agent guide renders its register step and error table", () => {
  const page = helpDocument(fs.readFileSync(helpPath, "utf8"));
  assert.match(page, /<title>访问 Knot<\/title>/);
  assert.match(page, /<code>POST \/api\/agent\/register<\/code>/);
  assert.match(page, /&lt;授权码&gt;/);
  assert.equal(page.includes("<授权码>"), false);
  assert.match(page, /<td>bad_email<\/td>/);
  assert.match(page, /<td>packet_unavailable<\/td>/);
});
