import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 模板里拼出来的类名（btn-<variant>、stage-<stage>）在标记里查不到字面量，
// 过渡的 enter/leave 类也只在 <Transition> 的 name 里出现，按「没有对应标记」
// 做死代码清理会把规则连根删掉，界面上只剩裸样式。下面几条把「拼出来的名字」
// 和「样式表里有没有这条」绑在一起。

// 首页演示从三张轮播换成一张图后，不需要再裁掉左右露出的卡片；
// 这里只盯住它在桌面不超出正文、在手机上按容器收窄。

const css = readFileSync(fileURLToPath(new URL("./styles.css", import.meta.url)), "utf8");

const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function blockOf(selector) {
  for (const m of cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").some((part) => part.trim() === selector)) return m[2];
  }
  return null;
}

test("首页演示图按容器收窄", () => {
  const block = blockOf(".gate-shot img");
  assert.ok(block, "styles.css 里没有 .gate-shot img");
  assert.match(block, /width:\s*100%;/);
  assert.match(block, /max-width:\s*680px;/);
  // 固定高度会把竖屏或窄屏上的图压扁，比例交给浏览器按原图算。
  assert.match(block, /height:\s*auto;/);
});

test("AppButton 的每个变体都有自己的底座规则", () => {
  const button = readFileSync(fileURLToPath(new URL("./components/AppButton.vue", import.meta.url)), "utf8");
  const list = button.match(/\[\s*("(?:[a-z-]+)"(?:\s*,\s*"[a-z-]+")*)\s*\]/);
  assert.ok(list, "AppButton.vue 里找不到 variant 白名单");
  const variants = [...list[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(variants.includes("primary") && variants.includes("icon"), "variant 白名单读错了");

  for (const variant of variants) {
    const block = blockOf(`.btn-${variant}`);
    assert.ok(block, `.btn-${variant} 没有底座规则，${variant} 变体会退回 .btn 的裸样式`);
  }

  // icon 变体靠这三条把方形按键压成 40/36px 的圆底：少了 padding 就退回
  // .btn 的左右 1rem，头像和图标被挤成竖条。
  const icon = blockOf(".btn-icon");
  assert.match(icon, /padding:\s*0;/);
  assert.match(icon, /aspect-ratio:\s*1;/);
  assert.match(icon, /border-radius:\s*50%;/);
});

test("economy 页拼出来的阶段类名都有配色", () => {
  // 取值来自 backend/src/actuary.js 的 stage，页面用 `stage-${report.stage}` 拼类名。
  for (const stage of ["seeding", "growing", "breakeven"]) {
    assert.ok(blockOf(`.stage-${stage}`), `styles.css 里没有 .stage-${stage}`);
  }
});

test("模板里的过渡名都有过渡规则", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  const files = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const full = `${at}${entry.name}`;
      if (entry.isDirectory()) walk(`${full}/`);
      else if (entry.name.endsWith(".vue")) files.push(full);
    }
  };
  walk(dir);

  const names = new Set();
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/<Transition[^>]*\bname="([a-z-]+)"/g)) names.add(m[1]);
  }
  assert.ok(files.length > 0, "一个 .vue 都没找到，解析写错了");
  for (const name of names) {
    assert.ok(blockOf(`.${name}-enter-active`), `模板用了过渡 ${name}，样式表里没有 .${name}-enter-active`);
    assert.ok(blockOf(`.${name}-enter-from`), `模板用了过渡 ${name}，样式表里没有 .${name}-enter-from`);
  }
});
