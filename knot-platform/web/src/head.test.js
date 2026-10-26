import assert from "node:assert/strict";
import test from "node:test";
import { canonicalPath, canonicalUrl, pageTitle, PAGE_TITLE_KEYS } from "./head.js";

test("页面标题跟路由走，没列的页面只写站点名", () => {
  const t = (key) => `[${key}]`;
  assert.equal(pageTitle({ routeName: "discover", siteName: "站", t }), "站 · [discover.pageTitle]");
  assert.equal(pageTitle({ routeName: "submissions", siteName: "站", t }), "站 · [submissions.title]");
  assert.equal(pageTitle({ routeName: "gate", siteName: "站", t }), "站");
  assert.equal(pageTitle({ routeName: undefined, siteName: "站", t }), "站");
});

test("每一页声明的规范地址都是自己，不是首页", () => {
  // 首页指回 /，其余页面指自己；两者都指 / 就等于发现页不存在。
  assert.equal(canonicalUrl("https://wang.xknot.si", "/"), "https://wang.xknot.si/");
  assert.equal(canonicalUrl("https://wang.xknot.si", "/discover"), "https://wang.xknot.si/discover");
  assert.equal(canonicalUrl("https://wang.xknot.si/", "/store"), "https://wang.xknot.si/store");
});

test("尾斜杠与空路径收敛到同一个地址", () => {
  assert.equal(canonicalPath("/"), "/");
  assert.equal(canonicalPath(""), "/");
  assert.equal(canonicalPath("/discover/"), "/discover");
  assert.equal(canonicalPath("/mine/submissions/"), "/mine/submissions");
  assert.equal(canonicalUrl("https://x.test/", "/discover/"), "https://x.test/discover");
});

test("标题表只指向真实存在的文案键", () => {
  // 键写错时 t() 会把键名原样返回，标签页于是显示「store.titel」。
  assert.ok(Object.keys(PAGE_TITLE_KEYS).length >= 6);
  for (const key of Object.values(PAGE_TITLE_KEYS)) {
    assert.match(key, /^[a-zA-Z]+(\.[a-zA-Z]+)+$/, `文案键不像 dot path：${key}`);
  }
});
