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

test("首帧内容写进挂载点，脚本没到也有本站的名字", () => {
  const BOOT_SHELL = `<html lang="en"><head><title>Knot</title></head><body>
    <div id="app">
      <div class="knot-boot" data-knot-boot>
        <p class="knot-boot-name" data-knot-name>Knot</p>
        <p class="knot-boot-line" data-knot-line>正在进入…</p>
        <a class="knot-boot-retry" data-knot-retry href="./">重新加载</a>
      </div>
    </div>
  </body></html>`;
  const html = renderEntryHtml(BOOT_SHELL, { site: SITE, origin: "https://wang.xknot.si" });
  assert.match(html, /data-knot-name>XKnot创世启元<\/p>/);
  assert.match(html, /data-knot-line>面向 AI 时代、服务于 Agent 的信息交换网。<\/p>/);
  assert.match(html, /data-knot-retry href="https:\/\/wang\.xknot\.si\/">/);
  // 没有 JS 时读到的仍是同一套自我介绍，不是两份互相矛盾的文案。
  const noscript = html.match(/<noscript>[\s\S]*?<\/noscript>/)?.[0] || "";
  assert.match(noscript, /一个站点，收发一手情报。/);
});

test("拿错文件时直接报错，不默默推一份空壳", () => {
  assert.throws(() => renderEntryHtml("<html></html>", { site: SITE, origin: "https://a.example" }), /app/);
  assert.throws(() => renderEntryHtml(SHELL, { site: SITE, origin: "wang.xknot.si" }), /origin/);
});

test("lang 跟着档案里的默认语种走", () => {
  // 主理人写了哪一项就用哪一项：US 服务器的英文站不会因为机器在美国而变成 en，
  // 反过来新加坡的中文站也一样。
  assert.equal(documentLang({ locale: "zh-TW", text: "a site for agents" }), "zh-TW");
  assert.equal(documentLang({ locale: "en", text: "一个站点" }), "en");
  // 旧档案还没有 locale：按文案推一次，与迁移脚本同一套规则。
  assert.equal(documentLang({ text: "一个站点" }), "zh-CN");
  assert.equal(documentLang({ text: "a site for agents" }), "en");
  const html = renderEntryHtml(SHELL, { site: { ...SITE, locale: "zh-TW" }, origin: "https://wang.xknot.si" });
  assert.match(html, /<html lang="zh-TW">/);
  const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
  assert.equal(JSON.parse(json).inLanguage, "zh-TW");
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
