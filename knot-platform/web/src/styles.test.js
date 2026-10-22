import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 首页轮播把左右两张卡片用位移露在容器外，容器本身不裁切时会把文档撑宽：
// 390px 视口实测 scrollWidth 440，手机上能横向拖动。这里盯住那条裁切规则，
// 免得以后调轮播样式时又被删掉。

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

test("首页轮播容器只裁横向溢出", () => {
  const start = css.indexOf(".gate-carousel {");
  assert.notEqual(start, -1, "styles.css 里没有 .gate-carousel");
  const block = css.slice(start, css.indexOf("}", start));
  assert.match(block, /overflow-x:\s*clip;/);
  // hidden 会把纵向也变成滚动容器，浮动阴影被切掉。
  assert.doesNotMatch(block, /overflow(-[xy])?:\s*hidden/);
});
