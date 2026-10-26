// 首屏兜底守卫。
//
// Vue 的 mount 会清空 #app，兜底页面写在里面。守卫要在挂载之前留快照、
// 出错时放回去，挂载成功之后不再接管。

import assert from "node:assert/strict";
import test from "node:test";
import { bootFailureHint, bootFailureLine, installBootGuard } from "./boot.js";

// 只需要 innerHTML 可读可写、querySelector 能找到兜底那三个节点。
// 恢复之后 querySelector 仍要能查到——快照里本来就带着 [data-knot-boot]。
function makeRoot(html) {
  const state = { html, classes: new Set(), line: "", hint: "" };
  const textNode = (key) => ({
    get textContent() {
      return state[key];
    },
    set textContent(value) {
      state[key] = value;
    },
  });
  const boot = {
    classList: { add: (name) => state.classes.add(name) },
    querySelector: (selector) => {
      if (selector === "[data-knot-line]") return textNode("line");
      if (selector === "[data-knot-hint]") return textNode("hint");
      return null;
    },
  };
  const root = {
    get innerHTML() {
      return state.html;
    },
    set innerHTML(value) {
      state.html = value;
    },
    querySelector(selector) {
      if (!state.html.includes("data-knot-boot")) return null;
      if (selector === "[data-knot-boot]") return boot;
      if (selector === "[data-knot-line]") return textNode("line");
      if (selector === "[data-knot-hint]") return textNode("hint");
      return null;
    },
  };
  return { root, state };
}

function makeWindow() {
  const handlers = new Map();
  return {
    addEventListener(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      handlers.get(type)?.delete(fn);
    },
    emit(type, event) {
      for (const fn of handlers.get(type) || []) fn(event);
    },
    listenerCount(type) {
      return handlers.get(type)?.size || 0;
    },
  };
}

const BOOT_HTML = '<div class="knot-boot" data-knot-boot><p data-knot-line>正在进入…</p></div>';

test("boot: a mount error puts the fallback back and names the error type", () => {
  const { root, state } = makeRoot(BOOT_HTML);
  const win = makeWindow();
  const guard = installBootGuard(root, { window: win });

  // Vue 挂载清空容器，然后渲染抛错。
  state.html = "";
  guard.fail(new TypeError("x is not a function"));

  assert.equal(guard.state, "failed");
  assert.equal(state.html, BOOT_HTML);
  assert.ok(state.classes.has("is-failed"));
  assert.match(state.line, /TypeError/);
  assert.match(state.hint, /截图/);
});

test("boot: an error after a successful mount does not replace the page", () => {
  const { root, state } = makeRoot(BOOT_HTML);
  const guard = installBootGuard(root, { window: makeWindow() });
  state.html = '<div class="app-shell">feed</div>';

  guard.ready();
  guard.fail(new Error("late"));

  assert.equal(guard.state, "ready");
  assert.equal(state.html, '<div class="app-shell">feed</div>');
});

test("boot: a failed resource load is not a crashed page", () => {
  // 图片 404 也会在 window 上触发 error，但没有 error 对象。
  const { root, state } = makeRoot(BOOT_HTML);
  const win = makeWindow();
  const guard = installBootGuard(root, { window: win });

  win.emit("error", { target: { tagName: "IMG" } });

  assert.equal(guard.state, "pending");
  assert.equal(state.html, BOOT_HTML);
});

test("boot: an unhandled rejection before the first paint restores the fallback", () => {
  const { root, state } = makeRoot(BOOT_HTML);
  const win = makeWindow();
  installBootGuard(root, { window: win });

  state.html = "";
  win.emit("unhandledrejection", { reason: new Error("chunk load failed") });

  assert.equal(state.html, BOOT_HTML);
  assert.match(state.line, /Error/);
});

test("boot: the global listeners are removed once the guard has settled", () => {
  const { root } = makeRoot(BOOT_HTML);
  const win = makeWindow();
  const guard = installBootGuard(root, { window: win });
  assert.equal(win.listenerCount("error"), 1);

  guard.ready();
  assert.equal(win.listenerCount("error"), 0);
  assert.equal(win.listenerCount("unhandledrejection"), 0);
});

test("boot: a successful mount marks <html> so the page is not judged failed", () => {
  // 兜底计时器只认这个标记。少了它，正常页面会在 6 秒后被改成「没有加载出来」。
  const { root } = makeRoot(BOOT_HTML);
  const attributes = new Map();
  const doc = {
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
  };
  const guard = installBootGuard(root, { window: makeWindow(), document: doc });

  guard.ready();
  assert.ok(attributes.has("data-knot-ready"));
});

test("boot: a failed mount leaves <html> unmarked", () => {
  const { root } = makeRoot(BOOT_HTML);
  const attributes = new Map();
  const doc = {
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
  };
  const guard = installBootGuard(root, { window: makeWindow(), document: doc });

  guard.fail(new Error("boom"));
  assert.equal(attributes.has("data-knot-ready"), false);
});

test("boot: a page without the fallback is left alone", () => {
  const seen = new Set();
  const root = {
    innerHTML: "",
    querySelector: () => null,
    classList: { add: (name) => seen.add(name) },
  };
  const guard = installBootGuard(root, { window: makeWindow() });

  assert.equal(guard.state, "absent");
  assert.doesNotThrow(() => guard.fail(new Error("x")));
  assert.doesNotThrow(() => guard.ready());
});

test("boot: the hint keeps a bounded message and never leaks a long one", () => {
  const long = "a".repeat(400);
  const hint = bootFailureHint(new RangeError(long));
  assert.ok(hint.length < 160, `hint 太长：${hint.length}`);
  assert.match(hint, /^如果反复出现/);
});

test("boot: an error without a name still says something readable", () => {
  assert.equal(bootFailureLine(undefined), "页面没有加载出来。");
  assert.match(bootFailureHint(undefined), /unknown/);
});
