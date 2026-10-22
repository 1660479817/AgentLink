import assert from "node:assert/strict";
import test from "node:test";
import { documentLang, renderEntryHtml, renderRobots, renderSitemap } from "./entry-html.mjs";

// 入口首页是纯静态的：SPA 跑起来之前，机器与分享预览只能读这份 HTML。
// 这里盯住「读得到」这件事本身，不涉及运行时。

const SHELL = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <meta name="description" content="Knot" />
    <title>Knot</title>
    <script type="module" crossorigin src="/assets/index-abc.js"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`;

const SITE = {
  name: "XKnot创世启元",
  tagline: "面向 AI 时代、服务于 Agent 的信息交换网。",
  intro: "一个站点，收发一手情报。",
  owner: "PaulWang",
  contact: "owner@example.com",
  region: "SG",
  logo: "https://wang.xknot.si/logo.png",
};

test("首页头里有站点名、介绍、canonical 与社交预览", () => {
  const html = renderEntryHtml(SHELL, { site: SITE, origin: "https://wang.xknot.si/" });
  assert.match(html, /<title>XKnot创世启元 · 面向 AI 时代、服务于 Agent 的信息交换网。<\/title>/);
  assert.match(html, /<meta name="description" content="一个站点，收发一手情报。" \/>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/wang\.xknot\.si\/" \/>/);
  assert.match(html, /<meta property="og:title" content="[^"]+" \/>/);
  assert.match(html, /<meta property="og:description" content="一个站点，收发一手情报。" \/>/);
  assert.match(html, /<meta property="og:url" content="https:\/\/wang\.xknot\.si\/" \/>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/wang\.xknot\.si\/logo\.png" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
});

test("没有 JS 也能读到一段自我介绍", () => {
  const html = renderEntryHtml(SHELL, { site: SITE, origin: "https://wang.xknot.si" });
  const noscript = html.match(/<noscript>[\s\S]*?<\/noscript>/)?.[0] || "";
  assert.match(noscript, /XKnot创世启元/);
  assert.match(noscript, /一个站点，收发一手情报。/);
  assert.match(noscript, /PaulWang · owner@example\.com/);
});

test("JSON-LD 不被 HTML 实体破坏", () => {
  const html = renderEntryHtml(SHELL, { site: SITE, origin: "https://wang.xknot.si" });
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(json, /&quot;/);
  const parsed = JSON.parse(json);
  assert.equal(parsed["@type"], "WebSite");
  assert.equal(parsed.url, "https://wang.xknot.si/");
  assert.equal(parsed.name, "XKnot创世启元");
});

test("站点名里的尖括号会被转义，不会注入标签", () => {
  const html = renderEntryHtml(SHELL, {
    site: { name: "<script>alert(1)</script>", tagline: "a & b" },
    origin: "https://wang.xknot.si",
  });
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /a &amp; b/);
});

test("SPA 挂载点与构建产物原样保留", () => {
  const html = renderEntryHtml(SHELL, { site: SITE, origin: "https://wang.xknot.si" });
  assert.match(html, /<div id="app"><\/div>/);
  assert.match(html, /src="\/assets\/index-abc\.js"/);
});

test("拿错文件时直接报错，不默默推一份空壳", () => {
  assert.throws(() => renderEntryHtml("<html></html>", { site: SITE, origin: "https://a.example" }), /app/);
  assert.throws(() => renderEntryHtml(SHELL, { site: SITE, origin: "wang.xknot.si" }), /origin/);
});

test("lang 跟着地区与文字走", () => {
  assert.equal(documentLang({ region: "CN", text: "hello" }), "zh-CN");
  assert.equal(documentLang({ region: "TW", text: "hello" }), "zh-TW");
  assert.equal(documentLang({ region: "SG", text: "一个站点" }), "zh-CN");
  assert.equal(documentLang({ region: "SG", text: "a site for agents" }), "en");
  const html = renderEntryHtml(SHELL, { site: SITE, origin: "https://wang.xknot.si" });
  assert.match(html, /<html lang="zh-CN">/);
});

test("robots.txt 放行页面，挡住接口与管理台", () => {
  const text = renderRobots("https://wang.xknot.si/");
  assert.match(text, /^User-agent: \*$/m);
  assert.match(text, /^Allow: \/$/m);
  assert.match(text, /^Disallow: \/api\/$/m);
  assert.match(text, /^Disallow: \/admin$/m);
  assert.match(text, /^Sitemap: https:\/\/wang\.xknot\.si\/sitemap\.xml$/m);
});

test("sitemap 只列真正的静态页", () => {
  const xml = renderSitemap("https://wang.xknot.si");
  assert.match(xml, /<loc>https:\/\/wang\.xknot\.si\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/wang\.xknot\.si\/discover<\/loc>/);
  // 账户态页面与文档不进 sitemap。
  assert.doesNotMatch(xml, /\/mine|\/friends|\/help/);
});
