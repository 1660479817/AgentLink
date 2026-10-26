import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createHtmlRenderer } from "./pageHtml.js";

// 反代投放的站点由 Backend 自己发页面，构建产物里只有通用的 "Knot"。
// 这里盯住三件事：站点自述真的写进去了；不知道域名时不猜；改档案后立刻生效。

// 构建产物默认是简体中文（web/index.html 的 lang），所以发现页的文案也按中文断言；
// 语种由档案的 locale 或模板的 lang 决定，最后一组测试单独盯这条规则。
const SHELL = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Knot" />
    <title>Knot</title>
    <script type="module" src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

function dist() {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-page-html-"));
  writeFileSync(path.join(dir, "index.html"), SHELL);
  writeFileSync(path.join(dir, "discover.html"), SHELL);
  return dir;
}

function profileOf(site, updatedAt = "2026-10-26T00:00:00Z") {
  let state = { site, updatedAt };
  return {
    view: () => state,
    set(next) {
      state = { site: next, updatedAt: new Date().toISOString() };
    },
  };
}

const SITE = { name: "cpswang", tagline: "Vibe coding for fun.", intro: "A personal Knot." };

function send(renderer, dir, kind) {
  let body = "";
  const res = {
    type() {
      return res;
    },
    send(value) {
      body = value;
      return res;
    },
    status() {
      return res;
    },
  };
  renderer.send(res, path.join(dir, kind === "discover" ? "discover.html" : "index.html"), kind);
  return body;
}

test("反代投放的首页带站点名、简介与绝对 canonical", () => {
  const dir = dist();
  const renderer = createHtmlRenderer({ dir, profile: profileOf(SITE), origin: "https://cpswang.xknot.si/" });
  const html = send(renderer, dir, "index");
  assert.match(html, /<title>cpswang · Vibe coding for fun\.<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/cpswang\.xknot\.si\/" \/>/);
  assert.match(html, /<meta name="description" content="A personal Knot\." \/>/);
});

test("发现页的 canonical 指自己，不是首页", () => {
  const dir = dist();
  const renderer = createHtmlRenderer({ dir, profile: profileOf(SITE), origin: "https://cpswang.xknot.si" });
  const html = send(renderer, dir, "discover");
  assert.match(html, /<title>cpswang · (?:Discover|发现)<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/cpswang\.xknot\.si\/discover" \/>/);
  assert.doesNotMatch(html, /<link rel="canonical" href="https:\/\/cpswang\.xknot\.si\/" \/>/);
});

test("档案是中文时，发现页的文案也用中文", () => {
  const dir = dist();
  const renderer = createHtmlRenderer({
    dir,
    profile: profileOf({ name: "创世启元", tagline: "面向 AI 时代的信息交换网。" }),
    origin: "https://example.test",
  });
  assert.match(send(renderer, dir, "discover"), /<title>创世启元 · 发现<\/title>/);
});

test("没配公开地址时不猜域名，发现页用相对 canonical", () => {
  const dir = dist();
  const renderer = createHtmlRenderer({ dir, profile: profileOf(SITE), origin: "" });
  // 首页需要绝对 canonical，没有就原样发出构建产物（标题保持构建时的值）。
  assert.match(send(renderer, dir, "index"), /<title>Knot<\/title>/);
  // 发现页有相对地址就够：它在哪个域名下都指向自己。
  const html = send(renderer, dir, "discover");
  assert.match(html, /<link rel="canonical" href="\/discover" \/>/);
  assert.equal(renderer.origin, "");
});

test("主理人改了自我介绍，下一次请求就是新的", () => {
  const dir = dist();
  const profile = profileOf(SITE);
  const renderer = createHtmlRenderer({ dir, profile, origin: "https://cpswang.xknot.si" });
  assert.match(send(renderer, dir, "index"), /<title>cpswang · Vibe coding for fun\.<\/title>/);

  profile.set({ ...SITE, name: "改名后的站", tagline: "新的介绍。" });
  const html = send(renderer, dir, "index");
  assert.match(html, /<title>改名后的站 · 新的介绍。<\/title>/);
});

test("没有档案时退回构建时的默认名，不抛错", () => {
  const dir = dist();
  const renderer = createHtmlRenderer({ dir, profile: null, origin: "https://example.test" });
  const html = send(renderer, dir, "discover");
  assert.match(html, /<title>Knot · 发现<\/title>/);
});

test("发现页的语种跟模板的 lang 走，不拿站名去猜", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "knot-page-html-en-"));
  writeFileSync(path.join(dir, "discover.html"), SHELL.replace('lang="zh-CN"', 'lang="en"'));
  const renderer = createHtmlRenderer({ dir, profile: profileOf({ name: "cpswang" }), origin: "" });
  assert.match(send(renderer, dir, "discover"), /<title>cpswang · Discover<\/title>/);
});

test("文件不在时说没找到，而不是发出一段空内容", () => {
  const dir = dist();
  const renderer = createHtmlRenderer({ dir, profile: profileOf(SITE), origin: "https://example.test" });
  let status = null;
  renderer.send(
    {
      status(value) {
        status = value;
        return this;
      },
      type() {
        return this;
      },
      send() {
        return this;
      },
    },
    path.join(dir, "missing.html"),
    "index"
  );
  assert.equal(status, 404);
});
