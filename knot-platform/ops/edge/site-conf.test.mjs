import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { renderTemplate } from "../scripts/render-config.mjs";

// 边缘模板只有一个 source，两种投放靠 KNOT_ENTRY_STATIC 分叉。
// 这里直接渲染真模板，盯住两件事：static 才声明缓存区，proxy 把首页也回源。

const TEMPLATE = readFileSync(fileURLToPath(new URL("./site.conf.template", import.meta.url)), "utf8");

const BASE = {
  KNOT_DOMAIN: "wang.example.com",
  KNOT_EDGE_WEB_ROOT: "/var/www/wang",
  KNOT_EDGE_MAX_BODY: "52m",
  KNOT_EDGE_PROXY_PORT: "18080",
  KNOT_EDGE_CACHE_DIR: "/var/cache/nginx/knot_uploads",
  KNOT_EDGE_CACHE_ZONE: "knot_uploads",
  KNOT_EDGE_CACHE_SIZE: "2g",
  KNOT_EDGE_SSL: "1",
  KNOT_EDGE_CERT: "/etc/letsencrypt/live/wang.example.com/fullchain.pem",
  KNOT_EDGE_KEY: "/etc/letsencrypt/live/wang.example.com/privkey.pem",
};

const render = (overrides) => renderTemplate(TEMPLATE, { ...BASE, ...overrides });

test("static 投放：首页从磁盘出，缓存区不在这份文件里声明", () => {
  const text = render({ KNOT_ENTRY_STATIC: "1" });
  assert.match(text, /root \/var\/www\/wang;/);
  assert.match(text, /try_files \$uri \$uri\/ \/index\.html;/);
  assert.match(text, /proxy_cache knot_uploads;/);
  // 缓存区整台边缘只允许一次，放在 cache.conf.template。
  assert.doesNotMatch(text, /^proxy_cache_path/m);
  // 静态兜底在那里，但 / 不应该整段回源。
  assert.doesNotMatch(text, /location \/ \{\n\s*proxy_pass/);
});

test("proxy 投放：不声明缓存区，首页整段回源", () => {
  const text = render({ KNOT_ENTRY_STATIC: "" });
  assert.doesNotMatch(text, /^proxy_cache_path/m);
  assert.match(text, /location \/ \{\n\s*proxy_pass http:\/\/127\.0\.0\.1:18080;/);
  // 上传也回源，但不带缓存键，避免和同机 static 入口抢同一个 zone。
  assert.doesNotMatch(text, /proxy_cache knot_uploads/);
});

test("缓存区单独成一份，整台边缘只声明一次", () => {
  const cache = renderTemplate(
    readFileSync(fileURLToPath(new URL("./cache.conf.template", import.meta.url)), "utf8"),
    BASE,
  );
  assert.match(cache, /^proxy_cache_path \/var\/cache\/nginx\/knot_uploads/m);
  assert.equal(cache.match(/proxy_cache_path/g).length, 1);
  assert.doesNotMatch(cache, /server \{/);
});

test("两种投放都保留管理接口 404 与 ACME 目录", () => {
  for (const flag of ["1", ""]) {
    const text = render({ KNOT_ENTRY_STATIC: flag });
    assert.match(text, /location \^~ \/api\/admin/);
    assert.match(text, /return 404 '\{"error":"not_found"\}'/);
    assert.match(text, /\.well-known\/acme-challenge\//);
  }
});

test("每个入口的 server_name 来自它自己的 KNOT_DOMAIN", () => {
  const text = render({
    KNOT_DOMAIN: "knot.example.net",
    KNOT_EDGE_CERT: "/etc/letsencrypt/live/knot.example.net/fullchain.pem",
    KNOT_EDGE_KEY: "/etc/letsencrypt/live/knot.example.net/privkey.pem",
    KNOT_ENTRY_STATIC: "1",
  });
  assert.match(text, /server_name knot\.example\.net;/);
  assert.match(text, /ssl_certificate \/etc\/letsencrypt\/live\/knot\.example\.net\/fullchain\.pem;/);
});

test("KNOT_EDGE_SSL=0 时只监听 80，不写证书", () => {
  const text = render({ KNOT_EDGE_SSL: "0", KNOT_ENTRY_STATIC: "1" });
  assert.doesNotMatch(text, /listen 443/);
  assert.doesNotMatch(text, /ssl_certificate/);
  assert.match(text, /listen 80;/);
});
