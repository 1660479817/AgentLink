// 「哪些地址回 SPA 壳」现在有三份清单，必须同时成立：
//
//   1. web/src/router/index.js      —— 真正定义了有哪些页面
//   2. ops/entry/site.conf.template —— static 投放的 nginx 白名单
//   3. backend/src/index.js         —— proxy 投放与本机直连的白名单
//
// 三份里漏一份，用户刷新一个已存在的页面就拿到 404，而开发机上一切正常
// （本地只有 vite，没有这两层）。所以这里不测某一层写对了没有，而是拿路由表
// 交叉比对另两份：新增页面时，忘了同步就会红，而不是发到线上才被发现。

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel) {
  return readFileSync(path.join(APP, rel), "utf8");
}

/** 路由表里真实存在的页面地址。通配兜底与 /discover 不参与：前者不是页面，后者有自己的 location。 */
function webRoutes() {
  const router = read("web/src/router/index.js");
  return [...router.matchAll(/path:\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((route) => route.startsWith("/") && !route.includes(":") && route !== "/discover");
}

/** backend 里那条 SPA_PATH，取源码原文再编译，避免在测试里抄一遍正则。 */
function backendPattern() {
  const source = read("backend/src/index.js");
  const literal = source.match(/const SPA_PATH = \/(.+)\/;\n/);
  assert.ok(literal, "backend/src/index.js 里找不到 SPA_PATH");
  return new RegExp(literal[1]);
}

/** nginx 模板里所有「回 index.html」的 regex location。 */
function nginxPatterns() {
  const template = read("ops/entry/site.conf.template");
  const blocks = [...template.matchAll(/location ~ (\S+) \{([\s\S]*?)\n    \}/g)];
  return blocks
    .filter(([, , body]) => body.includes("try_files /index.html =404;"))
    .map(([, pattern, body]) => ({ regex: new RegExp(pattern), noindex: /X-Robots-Tag[^;]*noindex/.test(body) }));
}

/** 账户态页面：爬虫没有会话，收进去的只会是登录页。两份白名单都要打上 noindex。 */
const ACCOUNT_ROUTES = ["/mine", "/mine/submissions", "/notifications", "/stars", "/friends"];

test("路由表里的每个页面在 backend 与 nginx 两层都回 SPA 壳", () => {
  const routes = webRoutes();
  assert.ok(routes.length >= 8, `路由表只解析出 ${routes.length} 条，可能解析规则失效了`);
  const backend = backendPattern();
  const nginx = nginxPatterns();
  for (const route of routes) {
    assert.ok(backend.test(route), `backend 的 SPA_PATH 不认 ${route}：刷新就是 404`);
    // 根地址由 location / 的 index index.html 提供，不需要单列白名单。
    if (route === "/") continue;
    assert.ok(
      nginx.some((rule) => rule.regex.test(route)),
      `nginx 白名单不认 ${route}：static 投放刷新就是 404`,
    );
  }
});

test("两层都不再拿首页冒充不存在的地址", () => {
  const backend = backendPattern();
  const nginx = nginxPatterns();
  for (const missing of ["/no-such-page", "/mine/other", "/store/x", "/help"]) {
    assert.equal(backend.test(missing), false, `backend 把 ${missing} 当成了页面`);
    assert.equal(
      nginx.some((rule) => rule.regex.test(missing)),
      false,
      `nginx 把 ${missing} 当成了页面`,
    );
  }
});

test("账户态页面在两层都标了 noindex，公开页面都没有", () => {
  const backendSource = read("backend/src/index.js");
  const accountLiteral = backendSource.match(/const ACCOUNT_PATH = \/(.+)\/;\n/);
  assert.ok(accountLiteral, "backend/src/index.js 里找不到 ACCOUNT_PATH");
  const backendAccount = new RegExp(accountLiteral[1]);
  const nginx = nginxPatterns();

  for (const route of ACCOUNT_ROUTES) {
    assert.ok(backendAccount.test(route), `backend 没有给 ${route} 标 noindex`);
    assert.ok(
      nginx.some((rule) => rule.regex.test(route) && rule.noindex),
      `nginx 没有给 ${route} 标 noindex`,
    );
  }
  for (const route of ["/store", "/economy", "/activity", "/delegate"]) {
    assert.equal(backendAccount.test(route), false, `backend 把公开页面 ${route} 标成了 noindex`);
    const hit = nginx.find((rule) => rule.regex.test(route));
    assert.ok(hit, `nginx 少了 ${route}`);
    assert.equal(hit.noindex, false, `nginx 把公开页面 ${route} 标成了 noindex`);
  }
});

test("两层的 /discover.html 都指回 /discover，只有一份可索引地址", () => {
  // static 投放由 nginx 回 301，proxy 投放（伙伴站）由 Backend 回 301。
  // 少一层，同一个页面就有两个都能打开的地址，canonical 归一之前先被抓两遍。
  const nginx = read("ops/entry/site.conf.template");
  assert.match(nginx, /location = \/discover\.html \{\s*return 301 \/discover;/);

  const backend = read("backend/src/index.js");
  assert.match(
    backend,
    /app\.get\("\/discover\.html",[\s\S]{0,120}res\.redirect\(301, "\/discover"\)/,
    "Backend 没有把 /discover.html 指回 /discover：proxy 投放的站点会两个地址都能打开",
  );
});

test("两层的 /i/<记录 id> 都指回深链", () => {
  // 早先 Agent 自己拼出来的分享地址长这样；入口与 Backend 各补一条 301，
  // static 与 proxy 两种投放才不会一个能开、一个 404。
  const nginx = read("ops/entry/site.conf.template");
  assert.match(
    nginx,
    /location ~ "\^\/i\/\(\[0-9a-fA-F-\]\{36\}\)\/\?\$" \{\s*return 301 \/discover\?post=\$1;/,
    "nginx 没有把 /i/<记录 id> 指回深链",
  );

  const backend = read("backend/src/index.js");
  assert.match(
    backend,
    /app\.get\("\/i\/:id",[\s\S]{0,240}recordPath\(req\.params\.id\)[\s\S]{0,240}res\.redirect\(301, target\)/,
    "Backend 没有把 /i/<记录 id> 指回深链：proxy 投放与本机直连会 404",
  );
});
