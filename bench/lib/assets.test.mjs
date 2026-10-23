import test from "node:test";
import assert from "node:assert/strict";
import { assetPaths } from "./assets.js";

// 这份正则在 k6 与 scripts 之间共用：两边各写一份时，改一处忘一处，
// 「压到的主包」和「报告里说的主包」就不是同一批文件。

test("从 index.html 里抠出 /assets 下的 js 与 css", () => {
  const html = `
    <script type="module" crossorigin src="/assets/index-DWdta6-w.js"></script>
    <link rel="stylesheet" href="/assets/main-Bw0Se19G.css">
    <script type="module" src="/assets/DiscoverView-XPOXiA9q.js"></script>
  `;
  assert.deepEqual(assetPaths(html).sort(), [
    "/assets/DiscoverView-XPOXiA9q.js",
    "/assets/index-DWdta6-w.js",
    "/assets/main-Bw0Se19G.css",
  ]);
});

test("重复引用只算一次，其它路径与协议外链不要", () => {
  const html = `
    <script src="/assets/a.js"></script>
    <script src="/assets/a.js"></script>
    <img src="/media/x.png">
    <script src="https://cdn.example.com/assets/b.js"></script>
    <script src="/static/c.js"></script>
  `;
  assert.deepEqual(assetPaths(html), ["/assets/a.js"]);
});

test("空页面与空值返回空数组", () => {
  assert.deepEqual(assetPaths(""), []);
  assert.deepEqual(assetPaths(null), []);
  assert.deepEqual(assetPaths(undefined), []);
});
