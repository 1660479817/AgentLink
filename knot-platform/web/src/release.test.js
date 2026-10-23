import assert from "node:assert/strict";
import { test } from "node:test";
import { entryFromHtml, hasDraft, releaseChanged, runningEntry, startReleaseWatch } from "./release.js";

const OLD = "/assets/index-old.js";
const NEW = "/assets/index-new.js";

function built(src) {
  return `<script type="module" crossorigin src="${src}"></script>`;
}

function draftRoot({ fields = [], files = [], media = false } = {}) {
  return {
    querySelectorAll(selector) {
      if (String(selector).includes("file")) return files;
      return fields;
    },
    querySelector() {
      return media ? {} : null;
    },
  };
}

function watchRelease({ html, blocked, document: doc }) {
  const calls = [];
  let shown = null;
  const handle = startReleaseWatch({
    current: () => OLD,
    fetchText: async () => html,
    blocked,
    reload: () => calls.push("reload"),
    onPending: (show) => {
      shown = show;
    },
    schedule: () => 0,
    cancel: () => {},
    document: doc,
  });
  return {
    calls,
    shown: () => shown,
    handle,
  };
}

test("the built page entry is the hashed module script", () => {
  const html = `<!DOCTYPE html><html><head>
    <script type="module" crossorigin src="/assets/index-DlHf8s9P.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-bbbbbbbb.css">
  </head></html>`;
  assert.equal(entryFromHtml(html), "/assets/index-DlHf8s9P.js");
});

test("a module script with src before type still counts", () => {
  assert.equal(
    entryFromHtml(`<script src="/assets/index-abc.js" type="module"></script>`),
    "/assets/index-abc.js"
  );
});

test("the dev page entry is the source module", () => {
  assert.equal(
    entryFromHtml(`<script type="module" src="/src/main.js"></script>`),
    "/src/main.js"
  );
});

test("a page without a module script is not a release", () => {
  assert.equal(entryFromHtml("<html><body>offline</body></html>"), "");
  assert.equal(releaseChanged(OLD, "<html></html>"), false);
});

test("the same entry is not a new release", () => {
  assert.equal(releaseChanged(OLD, built(OLD)), false);
  assert.equal(releaseChanged(OLD, built(`${OLD}?v=2`)), false);
});

test("a different entry is a new release", () => {
  assert.equal(releaseChanged(OLD, built(NEW)), true);
});

test("the running entry is the app module, not the dev client", () => {
  const doc = {
    querySelectorAll() {
      return [
        { getAttribute: () => "/@vite/client" },
        { getAttribute: () => "/src/main.js?t=1792114508748" },
      ];
    },
  };
  assert.equal(runningEntry(doc), "/src/main.js");
  assert.equal(
    runningEntry({
      querySelectorAll() {
        return [{ getAttribute: () => "/assets/index-abc.js" }];
      },
    }),
    "/assets/index-abc.js"
  );
  assert.equal(runningEntry({ querySelectorAll: () => [] }), "");
});

test("typed text, a chosen file, and unsent media count as a draft", () => {
  assert.equal(hasDraft(draftRoot()), false);
  assert.equal(hasDraft(draftRoot({ fields: [{ value: "  " }] })), false);
  assert.equal(hasDraft(draftRoot({ fields: [{ value: "一句" }] })), true);
  assert.equal(hasDraft(draftRoot({ files: [{ files: { length: 1 } }] })), true);
  assert.equal(hasDraft(draftRoot({ files: [{ files: { length: 0 } }] })), false);
  assert.equal(hasDraft(draftRoot({ media: true })), true);
});

test("an idle page reloads when the entry changes", async () => {
  const watched = watchRelease({ html: built(NEW), blocked: () => false });
  await watched.handle.check();
  assert.deepEqual(watched.calls, ["reload"]);
  assert.equal(watched.shown(), false);
  watched.handle.stop();
});

test("a busy page waits, then reloads once it is clear", async () => {
  let busy = true;
  const watched = watchRelease({ html: built(NEW), blocked: () => busy });
  await watched.handle.check();
  assert.deepEqual(watched.calls, []);
  assert.equal(watched.shown(), true);
  busy = false;
  watched.handle.poke();
  assert.deepEqual(watched.calls, ["reload"]);
  watched.handle.poke();
  assert.deepEqual(watched.calls, ["reload"]);
  watched.handle.stop();
});

test("the same entry hides the notice", async () => {
  const watched = watchRelease({ html: built(OLD), blocked: () => true });
  await watched.handle.check();
  assert.deepEqual(watched.calls, []);
  assert.equal(watched.shown(), false);
  watched.handle.stop();
});

test("a failed fetch leaves the page alone", async () => {
  const calls = [];
  let shown = null;
  const handle = startReleaseWatch({
    current: () => OLD,
    fetchText: async () => {
      throw new Error("offline");
    },
    blocked: () => false,
    reload: () => calls.push("reload"),
    onPending: (show) => {
      shown = show;
    },
    schedule: () => 0,
    cancel: () => {},
  });
  await handle.check();
  assert.deepEqual(calls, []);
  assert.equal(shown, null);
  handle.stop();
});

test("returning to the tab checks again", async () => {
  let fetches = 0;
  let state = "hidden";
  const listeners = {};
  const doc = {
    get visibilityState() {
      return state;
    },
    addEventListener(name, fn) {
      listeners[name] = fn;
    },
    removeEventListener() {},
  };
  const handle = startReleaseWatch({
    current: () => OLD,
    fetchText: async () => {
      fetches += 1;
      return built(OLD);
    },
    blocked: () => false,
    reload: () => {},
    onPending: () => {},
    schedule: () => 0,
    cancel: () => {},
    document: doc,
  });
  state = "visible";
  listeners.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetches, 1);
  handle.stop();
});

test("a check in flight when the watcher stops does not reload", async () => {
  const calls = [];
  let shown = null;
  let release = () => {};
  const handle = startReleaseWatch({
    current: () => OLD,
    fetchText: () =>
      new Promise((resolve) => {
        release = () => resolve(built(NEW));
      }),
    blocked: () => false,
    reload: () => calls.push("reload"),
    onPending: (show) => {
      shown = show;
    },
    schedule: () => 0,
    cancel: () => {},
  });
  const pending = handle.check();
  handle.stop();
  release();
  await pending;
  assert.deepEqual(calls, []);
  assert.equal(shown, null);
  // 停止之后连手动再问一次也不该有动作。
  await handle.check();
  assert.deepEqual(calls, []);
});
