export const RELEASE_CHECK_MS = 15 * 60 * 1000;

const DRAFT_FIELDS = [
  "textarea",
  "input[type='text']",
  "input[type='search']",
  "input[type='url']",
  "input[type='email']",
  "input[type='password']",
  "input[type='tel']",
  "input[type='number']",
  "input:not([type])",
].join(", ");

const DRAFT_MEDIA = ".share-photos, .share-files, .intel-photo-frame.has-photo, .mention-chips";

export function scriptPath(src, base = "http://knot.local") {
  const value = String(src || "").trim();
  if (!value) return "";
  try {
    return new URL(value, base).pathname;
  } catch {
    return "";
  }
}

export function entryFromHtml(html) {
  const tags = String(html || "").match(/<script\b[^>]*>/gi) || [];
  const srcs = [];
  for (const tag of tags) {
    if (!/\btype\s*=\s*["']module["']/i.test(tag)) continue;
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (src) srcs.push(scriptPath(src[1]));
  }
  return preferredEntry(srcs);
}

const ENTRY_PATH = /\/assets\/index-|\/src\/main\./;

export function preferredEntry(srcs) {
  return srcs.find((src) => ENTRY_PATH.test(src)) || srcs[0] || "";
}

export function runningEntry(doc) {
  const nodes = doc?.querySelectorAll?.("script[type='module'][src]") || [];
  const srcs = [...nodes].map((node) => scriptPath(node.getAttribute?.("src") || "")).filter(Boolean);
  return preferredEntry(srcs);
}

export function releaseChanged(current, html) {
  const next = entryFromHtml(html);
  if (!current || !next) return false;
  return current !== next;
}

export function hasDraft(root) {
  if (!root?.querySelectorAll) return false;
  for (const node of root.querySelectorAll(DRAFT_FIELDS)) {
    if (String(node.value || "").trim()) return true;
  }
  for (const node of root.querySelectorAll("input[type='file']")) {
    if (node.files?.length) return true;
  }
  return Boolean(root.querySelector?.(DRAFT_MEDIA));
}

export function startReleaseWatch({
  current,
  fetchText,
  blocked,
  reload,
  onPending,
  intervalMs = RELEASE_CHECK_MS,
  schedule = (fn, ms) => setInterval(fn, ms),
  cancel = (timer) => clearInterval(timer),
  document: doc,
} = {}) {
  let pending = false;
  let ticket = 0;
  let reloading = false;
  // 停止后仍在飞的 fetch 不许再叫 onPending / reload：
  // 页面可能已经在跳转，这时候回落或弹「有新版本」都会落在错的页面上。
  let stopped = false;

  function settle() {
    if (stopped || reloading) return;
    if (!pending) {
      onPending(false);
      return;
    }
    if (blocked()) {
      onPending(true);
      return;
    }
    reloading = true;
    onPending(false);
    reload();
  }

  async function check() {
    if (stopped) return;
    const mine = ++ticket;
    let html = "";
    try {
      html = await fetchText();
    } catch {
      return;
    }
    if (stopped || mine !== ticket || reloading) return;
    pending = releaseChanged(current(), html);
    settle();
  }

  function poke() {
    if (stopped || !pending || reloading) return;
    settle();
  }

  let removeDraft = () => {};
  let removeVisibility = () => {};
  let observer = null;
  if (doc?.addEventListener) {
    const onVisible = () => {
      if (doc.visibilityState === "visible") void check();
    };
    const onDraft = () => poke();
    doc.addEventListener("visibilitychange", onVisible);
    doc.addEventListener("input", onDraft, true);
    doc.addEventListener("change", onDraft, true);
    removeVisibility = () => doc.removeEventListener("visibilitychange", onVisible);
    removeDraft = () => {
      doc.removeEventListener("input", onDraft, true);
      doc.removeEventListener("change", onDraft, true);
    };
    if (doc.body && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => poke());
      observer.observe(doc.body, { childList: true, subtree: true });
    }
  }

  const timer = schedule(() => {
    void check();
  }, intervalMs);

  return {
    check,
    poke,
    stop() {
      stopped = true;
      cancel(timer);
      removeDraft();
      removeVisibility();
      observer?.disconnect();
    },
  };
}
