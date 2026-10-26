// 首屏兜底守卫。
//
// Vue 的 mount 会先清空 #app，而兜底页面就写在 #app 里。首帧渲染抛一次错，
// 屏幕上唯一的内容和重试入口一起被抹掉，什么都不剩。所以挂载前留一份快照，
// 首帧还没渲染成功时出的错都把快照放回去。
//
// 渲染成功之后就不再接管：一个偶发的接口报错不该把整页换成一屏兜底。

const BOOT = "[data-knot-boot]";
const LINE = "[data-knot-line]";
const HINT = "[data-knot-hint]";
// 错误消息可能带内部路径，只留前一小段，够定位是哪一类问题。
const MESSAGE_LIMIT = 80;

// 提示行只报错误类型，不报整条消息：TypeError 说明缺 API，堆栈只会让人更慌。
export function bootFailureLine(error) {
  const name = String(error?.name || "").trim();
  return name ? `页面没有加载出来（${name}）。` : "页面没有加载出来。";
}

// 第二行：截短的详情，加截图指引，便于只有单台设备复现时定位。
export function bootFailureHint(error) {
  const name = String(error?.name || "").trim();
  const message = String(error?.message || "").trim().replace(/\s+/g, " ").slice(0, MESSAGE_LIMIT);
  const detail = [name, message].filter(Boolean).join(": ") || "unknown";
  return `如果反复出现，请把这一行截图发给站主：${detail}`;
}

/**
 * 盯住首屏。必须在 `app.mount()` 之前调用。
 * @param {Element|null} root 挂载容器（#app）
 * @param {{ document?: Document, window?: Window }} [options] 测试注入用
 * @returns {{ state: "absent"|"pending"|"ready"|"failed", ready: () => void, fail: (error: unknown) => void }}
 */
export function installBootGuard(root, options = {}) {
  const win = options.window || globalThis.window;
  const doc = options.document || root?.ownerDocument || globalThis.document;
  const absent = { state: "absent", ready() {}, fail() {} };
  if (!root || typeof root.querySelector !== "function" || !root.querySelector(BOOT)) return absent;

  const snapshot = root.innerHTML;
  let state = "pending";

  function detach() {
    win?.removeEventListener?.("error", onError);
    win?.removeEventListener?.("unhandledrejection", onRejection);
  }

  function fail(error) {
    if (state !== "pending") return;
    state = "failed";
    detach();
    root.innerHTML = snapshot;
    const boot = root.querySelector(BOOT);
    if (!boot) return;
    boot.classList?.add("is-failed");
    const line = boot.querySelector(LINE);
    if (line) line.textContent = bootFailureLine(error);
    const hint = boot.querySelector(HINT);
    if (hint) hint.textContent = bootFailureHint(error);
  }

  // 标记打在 <html> 上：首页、登录门、信息流的根节点各不相同，按视图 class 判断会误伤。
  // index.html 里的兜底计时器只认这个标记。
  function ready() {
    if (state !== "pending") return;
    state = "ready";
    detach();
    doc?.documentElement?.setAttribute?.("data-knot-ready", "");
  }

  // 资源加载失败的事件没有 error 对象。一张图 404 不算页面崩溃。
  function onError(event) {
    if (event?.error) fail(event.error);
  }

  function onRejection(event) {
    fail(event?.reason);
  }

  win?.addEventListener?.("error", onError);
  win?.addEventListener?.("unhandledrejection", onRejection);

  return {
    get state() {
      return state;
    },
    ready,
    fail,
  };
}
