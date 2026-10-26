// 首屏兜底。
//
// Vue 3 的 mount 会先清空 #app，而兜底页面正写在 #app 里。挂载之后再出错，
// 屏幕上就什么都不剩了——微信内置浏览器（旧 X5 内核）里「一片空白、怎么刷都不出来」
// 就是这个样子：静态兜底本来能显示，被清空后连重试按钮都没了。
//
// 所以在挂载之前留一份快照。首屏还没渲染成功时出的任何错，都把快照放回去，
// 并把错误类型写进提示行：用户至少看到站点名，也能把那一行截图发过来。
// 渲染成功之后就不再接管——一个偶发的接口报错不该把整页换成一屏兜底。

const BOOT = "[data-knot-boot]";
const LINE = "[data-knot-line]";
const HINT = "[data-knot-hint]";
// 错误消息里可能带内部路径，只留前一小段；够定位是哪一类问题。
const MESSAGE_LIMIT = 80;

// 出错时给用户看的那一行。只报错误类型，不报整条消息：
// 「TypeError」能告诉我们是缺 API，整段堆栈只会让人更慌。
export function bootFailureLine(error) {
  const name = String(error?.name || "").trim();
  return name ? `页面没有加载出来（${name}）。` : "页面没有加载出来。";
}

// 第二行：截短的详情，加上「截图发给我们」的指引。
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

  function ready() {
    if (state !== "pending") return;
    state = "ready";
    detach();
    // 挂载成功的标记打在 <html> 上，而不是找某个视图的 class：
    // 首页、登录门、信息流三种首屏的根节点各不相同，用 class 判断迟早误伤。
    // index.html 里的兜底计时器也只认这个标记。
    doc?.documentElement?.setAttribute?.("data-knot-ready", "");
    // 挂载成功就不再需要快照：留着它等于把一份不会再用的 DOM 常驻在内存里。
  }

  function onError(event) {
    // 资源加载失败的事件没有 error 对象。一张 404 的图不算页面崩溃。
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
