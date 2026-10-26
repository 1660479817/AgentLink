import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { LOCALES } from "../web/src/lib/i18n.js";
import {
  DEFAULT_ORIGIN,
  directoryInstances,
  injectDirectoryFallback,
  normalizeOrigin,
  renderDirectoryFallback,
  renderDirectoryPage,
  renderRobots,
  renderSitemap,
  writeSeo,
} from "./build-seo.mjs";

const SAMPLE = {
  instances: [
    {
      id: "wang",
      name: "XKnot创世",
      tagline: "面向 Agent 的信息交换网",
      intro: "第一个 Knot 实例。",
      tags: ["创世节点", "Agent"],
      url: "https://wang.xknot.si/",
      health: { status: "up", hidden: false },
    },
    {
      id: "hidden",
      name: "Hidden",
      url: "https://hidden.xknot.si",
      health: { status: "down", hidden: true },
    },
    {
      id: "bad",
      name: "Bad",
      url: "javascript:alert(1)",
      health: { status: "up" },
    },
  ],
};

const CATALOGS = {
  en: {
    directory: { link: "Instance directory", title: "Instance directory — XKnot Federation" },
    status: { up: "Operational", down: "Down", unknown: "Unknown" },
  },
  "zh-CN": {
    directory: {
      link: "实例目录",
      title: "实例目录 — XKnot 联邦",
      heading: "实例目录",
      all: "查看完整实例目录",
    },
    status: { up: "运行中", down: "离线", unknown: "未知" },
  },
  "zh-TW": {
    directory: { link: "實例目錄", title: "實例目錄 — XKnot 聯邦" },
    status: { up: "運作中", down: "離線", unknown: "未知" },
  },
};

test("directoryInstances 只列可跳转的 https 站点，隐藏条目不出现", () => {
  const rows = directoryInstances(SAMPLE);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["wang"],
  );
  assert.equal(rows[0].url, "https://wang.xknot.si");
});

test("robots 放行页面，挡住接口与管理台，并给出 sitemap 绝对地址", () => {
  const text = renderRobots("https://example.test/");
  assert.match(text, /^User-agent: \*$/m);
  assert.match(text, /^Allow: \/$/m);
  assert.match(text, /^Disallow: \/api\/$/m);
  assert.match(text, /^Disallow: \/admin$/m);
  assert.match(text, /^Sitemap: https:\/\/example\.test\/sitemap\.xml$/m);
  assert.equal(renderRobots(), renderRobots(DEFAULT_ORIGIN));
});

test("sitemap 收三个语种入口、三份目录与 knot-help", () => {
  const text = renderSitemap("https://example.test");
  const locs = [...text.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(locs, [
    "/en/",
    "/en/instances/",
    "/zh-CN/",
    "/zh-CN/instances/",
    "/zh-TW/",
    "/zh-TW/instances/",
    "/knot-help",
  ].map((pathname) => `https://example.test${pathname}`));
  assert.ok(locs.length === 7);
});

test("静态目录页带 canonical、hreflang、实例链接与结构化数据", () => {
  const page = renderDirectoryPage({
    locale: "zh-CN",
    catalog: CATALOGS["zh-CN"],
    instances: directoryInstances(SAMPLE),
    origin: "https://example.test",
  });
  assert.match(page, /<html lang="zh-CN">/);
  assert.match(page, /<title>实例目录 — XKnot 联邦<\/title>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/example\.test\/zh-CN\/instances\/" \/>/);
  for (const locale of LOCALES) {
    assert.match(page, new RegExp(`hreflang="${locale}"`));
  }
  assert.match(page, /hreflang="x-default"/);
  assert.match(page, /<a href="https:\/\/wang\.xknot\.si" rel="noopener noreferrer">XKnot创世<\/a>/);
  assert.match(page, /运行中/);
  assert.match(page, /创世节点 · Agent/);
  assert.match(page, /"@type":"ItemList"/);
  assert.doesNotMatch(page, /hidden\.xknot\.si/);
});

test("目录页转义站点自述，不把 </script> 直接写进页面", () => {
  const page = renderDirectoryPage({
    locale: "en",
    catalog: CATALOGS.en,
    instances: directoryInstances({
      instances: [
        {
          id: "x",
          name: "</script><script>alert(1)</script>",
          tagline: "a & b",
          url: "https://x.xknot.si",
        },
      ],
    }),
    origin: "https://example.test",
  });
  assert.doesNotMatch(page, /<script>alert\(1\)<\/script>/);
  assert.match(page, /&lt;\/script&gt;/);
  assert.match(page, /a &amp; b/);
});

test("空目录给出空状态，不生成空列表", () => {
  const page = renderDirectoryPage({ locale: "en", catalog: CATALOGS.en, instances: [], origin: "https://example.test" });
  assert.match(page, /No instances listed yet\./);
  assert.doesNotMatch(page, /<ul class="list">/);
});

test("首页摘要只有一段，重复注入不会叠加", () => {
  const html = "<!doctype html><html><body><div id=\"app\"></div></body></html>";
  const fallback = renderDirectoryFallback({
    locale: "en",
    catalog: CATALOGS.en,
    instances: directoryInstances(SAMPLE),
  });
  const once = injectDirectoryFallback(html, fallback);
  const twice = injectDirectoryFallback(once, fallback);
  assert.equal(twice, once);
  assert.equal(twice.match(/<!-- knot-directory -->/g).length, 1);
  assert.match(twice, /<noscript>/);
  assert.match(twice, /https:\/\/wang\.xknot\.si/);
});

test("origin 只接受 http/https 绝对地址", () => {
  assert.equal(normalizeOrigin("https://xknot.si///"), "https://xknot.si");
  assert.throws(() => normalizeOrigin("xknot.si"), /绝对地址/);
  assert.throws(() => normalizeOrigin("ftp://xknot.si"), /http\/https/);
});

test("writeSeo 写出 robots、sitemap 与三个语种的目录页", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "xknot-seo-"));
  try {
    mkdirSync(path.join(dist, "data"), { recursive: true });
    writeFileSync(path.join(dist, "data", "hub.json"), JSON.stringify(SAMPLE));
    for (const locale of LOCALES) {
      mkdirSync(path.join(dist, locale), { recursive: true });
      writeFileSync(
        path.join(dist, locale, "index.html"),
        '<!doctype html><html><body><div id="app"></div></body></html>',
      );
    }

    const result = writeSeo({ distDir: dist, origin: "https://example.test", catalogs: CATALOGS });
    assert.deepEqual(result, { instances: 1, locales: LOCALES.length });
    assert.ok(existsSync(path.join(dist, "robots.txt")));
    assert.ok(existsSync(path.join(dist, "sitemap.xml")));

    for (const locale of LOCALES) {
      const page = readFileSync(path.join(dist, locale, "instances", "index.html"), "utf8");
      assert.match(page, new RegExp(`<html lang="${locale}">`));
      assert.match(page, /https:\/\/wang\.xknot\.si/);
      const home = readFileSync(path.join(dist, locale, "index.html"), "utf8");
      assert.equal(home.match(/<!-- knot-directory -->/g).length, 1);
    }
    assert.match(
      readFileSync(path.join(dist, "en", "instances", "index.html"), "utf8"),
      /Instance directory — XKnot Federation/,
    );

    // 再写一次仍只有一段摘要，构建可以重复执行。
    writeSeo({ distDir: dist, origin: "https://example.test", catalogs: CATALOGS });
    assert.equal(
      readFileSync(path.join(dist, "en", "index.html"), "utf8").match(/<!-- knot-directory -->/g).length,
      1,
    );
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("writeSeo 缺快照时明确报错", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "xknot-seo-missing-"));
  try {
    assert.throws(() => writeSeo({ distDir: dist }), /build-hub-data\.mjs/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
