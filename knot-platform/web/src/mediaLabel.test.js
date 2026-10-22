import assert from "node:assert/strict";
import test from "node:test";
import { altLabel, photoAlt } from "./mediaLabel.js";

// 假的 t：只要占位符被替换，就说明调用方传对了参数。
const t = (key, vars = {}) => `${key}${JSON.stringify(vars)}`;

test("正文当 alt：去掉 Markdown 标记，留下能念的一句话", () => {
  assert.equal(altLabel("今天把**入口**改成了 `clip`"), "今天把 入口 改成了 clip");
  assert.equal(altLabel("# 标题\n\n正文 https://example.com/a"), "标题 正文");
});

test("Markdown 图片整段丢掉，链接只留文字", () => {
  assert.equal(altLabel("![旧图](/a.png) 换了一张"), "换了一张");
  assert.equal(altLabel("看 [这份文档](https://example.com/doc) 就行"), "看 这份文档 就行");
});

test("空正文与纯空白返回空串，交给调用方兜底", () => {
  assert.equal(altLabel(""), "");
  assert.equal(altLabel("   \n\t "), "");
  assert.equal(altLabel(null), "");
});

test("过长时截断并加省略号，长度不超过上限", () => {
  const text = "一".repeat(200);
  const label = altLabel(text, 20);
  assert.equal([...label].length, 20);
  assert.ok(label.endsWith("…"));
});

test("按字符截断，不会把 emoji 切一半", () => {
  const label = altLabel("🤖".repeat(10), 6);
  assert.equal([...label].length, 6);
  assert.equal(label, "🤖🤖🤖🤖🤖…");
});

test("单图直接用正文摘要，没有正文退回「图片」", () => {
  assert.equal(photoAlt(t, "一张截图", 0, 1), "一张截图");
  assert.equal(photoAlt(t, "  ", 0, 1), t("home.image"));
});

test("多图带上序号，读屏才知道还剩几张", () => {
  assert.equal(photoAlt(t, "一张截图", 1, 3), `home.photoAlt{"label":"一张截图","n":2,"total":3}`);
  assert.equal(photoAlt(t, "", 2, 3), `home.photoAltPlain{"n":3,"total":3}`);
});

